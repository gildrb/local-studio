import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as Path from "node:path";

import type { SnapShotImageCodec, SnapShotRectangle } from "@t3tools/shared/snapShot/snapShotImage";
import * as Schema from "effect/Schema";

const SCRIPT_TIMEOUT_MS = 5_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type MacSnapShotEnvironment = {
  readonly screenRecording: boolean;
  readonly accessibility: boolean;
  readonly reduceMotion: boolean;
  readonly primary: SnapShotRectangle;
};

const decodeEnvironment = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      screenRecording: Schema.Boolean,
      accessibility: Schema.Boolean,
      reduceMotion: Schema.Boolean,
      primary: Schema.Struct({
        x: Schema.Number,
        y: Schema.Number,
        width: Schema.Number,
        height: Schema.Number,
      }),
    }),
  ),
);

const ENVIRONMENT_SCRIPT = `
ObjC.import("AppKit");
ObjC.import("CoreGraphics");
ObjC.import("ApplicationServices");
ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]);
ObjC.bindFunction("AXIsProcessTrusted", ["bool", []]);
function run() {
  const screen = $.NSScreen.screens.objectAtIndex(0).frame;
  return JSON.stringify({
    screenRecording: $.CGPreflightScreenCaptureAccess(),
    accessibility: $.AXIsProcessTrusted(),
    reduceMotion: $.NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion,
    primary: { x: 0, y: 0, width: screen.size.width, height: screen.size.height },
  });
}`;

const REQUEST_SCREEN_RECORDING_SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.bindFunction("CGRequestScreenCaptureAccess", ["bool", []]);
function run() {
  return String($.CGRequestScreenCaptureAccess());
}`;

const PROMPT_ACCESSIBILITY_SCRIPT = `
ObjC.import("ApplicationServices");
ObjC.bindFunction("AXIsProcessTrustedWithOptions", ["bool", ["id"]]);
function run() {
  return String($.AXIsProcessTrustedWithOptions($({ AXTrustedCheckOptionPrompt: true })));
}`;

// Renders the app's Finder icon at 64 points and 2x density, matching Electron's thumbnail.
const APP_ICON_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const image = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  if (image.isNil()) return "";
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, 128, 128, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0,
  );
  rep.size = $.NSMakeSize(64, 64);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.currentContext = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  image.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, 64, 64), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  return png.base64EncodedStringWithOptions(0).js;
}`;

function run(file: string, args: ReadonlyArray<string>): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(file, args, { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
  return promise;
}

function runScript(script: string, ...args: ReadonlyArray<string>): Promise<string> {
  return run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, ...args]);
}

export async function readMacSnapShotEnvironment(): Promise<MacSnapShotEnvironment> {
  return decodeEnvironment((await runScript(ENVIRONMENT_SCRIPT)).trim());
}

export async function requestMacScreenRecording(): Promise<void> {
  await runScript(REQUEST_SCREEN_RECORDING_SCRIPT);
}

export async function promptMacAccessibility(): Promise<void> {
  await runScript(PROMPT_ACCESSIBILITY_SCRIPT);
}

export async function openMacUrl(url: string): Promise<void> {
  await run("/usr/bin/open", [url]);
}

export async function macAppIconDataUrl(appPath: string): Promise<string | undefined> {
  const encoded = (await runScript(APP_ICON_SCRIPT, appPath)).trim();
  return encoded ? `data:image/png;base64,${encoded}` : undefined;
}

export function playMacSound(file: string): void {
  void run("/usr/bin/afplay", [file]).catch(() => undefined);
}

async function resizePng(png: Buffer, width: number, height: number): Promise<Buffer> {
  const directory = await mkdtemp(Path.join(tmpdir(), "t3-snapshot-resize-"));
  try {
    const input = Path.join(directory, "input.png");
    const output = Path.join(directory, "output.png");
    await writeFile(input, png);
    await run("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      "-z",
      String(height),
      String(width),
      input,
      "--out",
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** PNG decoding for the native core: dimensions come from the IHDR chunk, resizing from `sips`. */
export const macSnapShotImageCodec: SnapShotImageCodec = {
  open: (png) => {
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
    if (png.subarray(12, 16).toString("latin1") !== "IHDR") return undefined;
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width === 0 || height === 0) return undefined;
    return { width, height, resize: (size) => resizePng(png, size.width, size.height) };
  },
};
