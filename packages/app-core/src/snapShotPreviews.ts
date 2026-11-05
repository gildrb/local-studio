import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import * as Path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveDesktopStateDir } from "@t3tools/desktop/src/app/DesktopStatePaths.ts";
import {
  useComposerDraftStore,
  type ComposerImageAttachment,
} from "@t3tools/web/src/composerDraftStore.ts";
import * as Option from "effect/Option";

import type { FeatureContext } from "./feature.ts";

const PREVIEW_EXTENSION = ".png";

export function snapShotStateDirectory(context: FeatureContext): string {
  return resolveDesktopStateDir({
    baseDir: context.t3Home,
    isDevelopment: false,
    joinPath: Path.join,
    t3Home: Option.some(context.t3Home),
  });
}

function previewDirectory(context: FeatureContext): string {
  return Path.join(snapShotStateDirectory(context), "native-snap-shot-previews");
}

function previewFile(context: FeatureContext, id: string): string {
  return Path.join(previewDirectory(context), `${id}${PREVIEW_EXTENSION}`);
}

export function writeSnapShotPreview(context: FeatureContext, id: string, bytes: Buffer): string {
  mkdirSync(previewDirectory(context), { recursive: true });
  const path = previewFile(context, id);
  writeFileSync(path, bytes);
  return pathToFileURL(path).href;
}

export function composerImagePreviewPath(
  context: FeatureContext,
  image: ComposerImageAttachment,
): string | null {
  if (image.previewUrl.startsWith("file:")) return fileURLToPath(image.previewUrl);
  if (image.source?.kind !== "snap-shot" || !image.previewUrl.startsWith("data:")) return null;
  const comma = image.previewUrl.indexOf(",");
  if (comma === -1) return null;
  const path = previewFile(context, image.id);
  if (existsSync(path)) return path;
  try {
    writeSnapShotPreview(
      context,
      image.id,
      Buffer.from(image.previewUrl.slice(comma + 1), "base64"),
    );
    return path;
  } catch {
    return null;
  }
}

function liveSnapShotIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const draft of Object.values(useComposerDraftStore.getState().draftsByThreadKey)) {
    for (const image of draft.images) {
      if (image.source?.kind === "snap-shot") ids.add(image.id);
    }
  }
  return ids;
}

export function cleanUpSnapShotPreviews(context: FeatureContext): void {
  let running: Promise<void> | null = null;
  let rerun = false;
  let lastIds = "";
  const prune = () => {
    if (running) {
      rerun = true;
      return;
    }
    running = (async () => {
      do {
        rerun = false;
        const names = await readdir(previewDirectory(context)).catch((): string[] => []);
        const live = liveSnapShotIds();
        await Promise.all(
          names
            .filter(
              (name) =>
                name.endsWith(PREVIEW_EXTENSION) &&
                !live.has(name.slice(0, -PREVIEW_EXTENSION.length)),
            )
            .map((name) => rm(Path.join(previewDirectory(context), name), { force: true })),
        );
      } while (rerun);
    })().finally(() => {
      running = null;
    });
  };
  useComposerDraftStore.subscribe(() => {
    const ids = [...liveSnapShotIds()].toSorted().join("\n");
    if (ids === lastIds) return;
    lastIds = ids;
    prune();
  });
  lastIds = [...liveSnapShotIds()].toSorted().join("\n");
  prune();
}
