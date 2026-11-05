import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as Path from "node:path";

function readEntries(filePath: string): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

export function writeFileAtomically(filePath: string, contents: string): void {
  mkdirSync(Path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

export function createFileStorage(filePath: string): Storage {
  const entries = readEntries(filePath);
  const persist = () => writeFileAtomically(filePath, JSON.stringify(Object.fromEntries(entries)));
  return {
    get length() {
      return entries.size;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      const next = String(value);
      if (entries.get(key) === next) return;
      entries.set(key, next);
      persist();
    },
    removeItem(key) {
      if (entries.delete(key)) persist();
    },
    clear() {
      if (entries.size === 0) return;
      entries.clear();
      persist();
    },
  };
}

export function installLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}
