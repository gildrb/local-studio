// @effect-diagnostics nodeBuiltinImport:off -- This macOS platform boundary spawns native capture tools and reads their temporary output with Node.

import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";

import type { ActiveWindow } from "./ActiveWindow.ts";
import { fitSnapShotImage, snapShotImageCodec, type SnapShotSize } from "./snapShotImage.ts";

const MAC_SCREEN_CAPTURE_PATH = "/usr/sbin/screencapture";
const MAC_SCREEN_CAPTURE_TIMEOUT_MS = 15_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type MacSnapShotSource = {
  readonly name: string;
};

export function macSnapShotArguments(windowId: number, outputPath: string): string[] {
  return ["-l", String(windowId), "-o", "-x", "-t", "png", outputPath];
}

function runMacSnapShot(windowId: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      MAC_SCREEN_CAPTURE_PATH,
      macSnapShotArguments(windowId, outputPath),
      { timeout: MAC_SCREEN_CAPTURE_TIMEOUT_MS },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

export async function captureMacWindowSnapshot(
  active: ActiveWindow,
  outputPath: string,
  maxSize: SnapShotSize,
): Promise<{ readonly source: MacSnapShotSource; readonly png: Buffer }> {
  await runMacSnapShot(active.id, outputPath);
  const capturedPng = await NodeFSP.readFile(outputPath);
  if (
    capturedPng.length < PNG_SIGNATURE.length ||
    !capturedPng.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("macOS returned an invalid snapshot.");
  }
  const image = snapShotImageCodec().open(capturedPng);
  if (!image) throw new Error("macOS returned an invalid snapshot.");
  const png = await fitSnapShotImage(image, capturedPng, maxSize);
  if (png !== capturedPng) await NodeFSP.writeFile(outputPath, png);
  return {
    source: {
      name: active.title.trim() || active.owner.name.trim() || "Window",
    },
    png,
  };
}
