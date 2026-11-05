import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Path from "node:path";

const WEB_SOURCE_ROOT = Path.resolve(
  Path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/src",
);

const SOURCE_EXTENSIONS = [".ts", ".js", ".mjs"] as const;

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function resolveSourcePath(basePath: string): string | null {
  if (isFile(basePath)) return basePath;
  for (const extension of SOURCE_EXTENSIONS) {
    if (isFile(`${basePath}${extension}`)) return `${basePath}${extension}`;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const indexPath = Path.join(basePath, `index${extension}`);
    if (isFile(indexPath)) return indexPath;
  }
  return null;
}

function parentDirectory(parentURL: string | undefined): string | null {
  if (parentURL === undefined || !parentURL.startsWith("file:")) return null;
  const parentPath = fileURLToPath(parentURL);
  if (parentPath.split(Path.sep).includes("node_modules")) return null;
  return Path.dirname(parentPath);
}

function webSourceCandidate(specifier: string, parentURL: string | undefined): string | null {
  const directory = parentDirectory(parentURL);
  if (directory === null) return null;
  if (specifier.startsWith("~/")) {
    return Path.join(WEB_SOURCE_ROOT, specifier.slice(2));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return Path.resolve(directory, specifier);
  }
  return null;
}

function isBareSubpathWithoutExtension(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes(":")) {
    return false;
  }
  const segments = specifier.split("/");
  const subpath = segments.slice(specifier.startsWith("@") ? 2 : 1);
  const last = subpath.at(-1);
  return last !== undefined && Path.extname(last) === "";
}

export function registerSourceResolution(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const candidate = webSourceCandidate(specifier, context.parentURL);
      const resolved = candidate === null ? null : resolveSourcePath(candidate);
      if (resolved !== null) return nextResolve(pathToFileURL(resolved).href, context);
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!isBareSubpathWithoutExtension(specifier)) throw error;
        return nextResolve(`${specifier}.mjs`, context);
      }
    },
  });
}
