import type { ScopedThreadRef } from "@t3tools/contracts";
import { isWindowsAbsolutePath, normalizeProjectPathForComparison } from "@t3tools/shared/path";

import { resolvePathLinkTarget } from "./terminal-links";

function normalizedRelativePathSegments(filePath: string): ReadonlyArray<string> | null {
  if (filePath.startsWith("/") || isWindowsAbsolutePath(filePath) || /^[a-zA-Z]:/.test(filePath)) {
    return null;
  }

  const segments = filePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  return segments;
}

function repositoryRelativeWorkspaceSegments(
  workspaceRoot: string | undefined,
  repositoryRoot: string | undefined,
): ReadonlyArray<string> | null {
  if (!workspaceRoot || !repositoryRoot) return null;

  const normalizedWorkspaceRoot = normalizeProjectPathForComparison(workspaceRoot);
  const normalizedRepositoryRoot = normalizeProjectPathForComparison(repositoryRoot);
  if (normalizedWorkspaceRoot === normalizedRepositoryRoot) return [];

  const separator = normalizedRepositoryRoot.includes("\\") ? "\\" : "/";
  const repositoryPrefix = normalizedRepositoryRoot.endsWith(separator)
    ? normalizedRepositoryRoot
    : `${normalizedRepositoryRoot}${separator}`;
  if (!normalizedWorkspaceRoot.startsWith(repositoryPrefix)) return null;

  return normalizedWorkspaceRoot
    .slice(repositoryPrefix.length)
    .split(/[\\/]+/)
    .filter(Boolean);
}

export type DiffPathForWorkspaceInput = {
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot: string | undefined;
};

export function resolveDiffPathForWorkspace(input: DiffPathForWorkspaceInput): string | null {
  const fileSegments = normalizedRelativePathSegments(input.filePath);
  if (!fileSegments) return null;

  const workspaceSegments = repositoryRelativeWorkspaceSegments(
    input.workspaceRoot,
    input.repositoryRoot,
  );
  if (!workspaceSegments || workspaceSegments.length === 0) {
    return fileSegments.join("/");
  }

  const caseInsensitive = input.repositoryRoot
    ? isWindowsAbsolutePath(input.repositoryRoot)
    : false;
  const belongsToWorkspace = workspaceSegments.every((segment, index) => {
    const candidate = fileSegments[index];
    if (candidate === undefined) return false;
    return caseInsensitive ? candidate.toLowerCase() === segment : candidate === segment;
  });
  if (!belongsToWorkspace) return null;

  const relativeSegments = fileSegments.slice(workspaceSegments.length);
  return relativeSegments.length > 0 ? relativeSegments.join("/") : null;
}

export type DiffFilePrimaryActionInput = {
  readonly threadRef: ScopedThreadRef | null;
  readonly filePath: string;
  readonly activeCwd: string | undefined;
  readonly repositoryRoot?: string | undefined;
};

export type DiffFilePrimaryAction =
  | { readonly kind: "none" }
  | {
      readonly kind: "open-in-files-panel";
      readonly threadRef: ScopedThreadRef;
      readonly filePath: string;
    }
  | { readonly kind: "open-in-editor"; readonly targetPath: string };

export function resolveDiffFilePrimaryAction(
  input: DiffFilePrimaryActionInput,
): DiffFilePrimaryAction {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath: input.filePath,
    workspaceRoot: input.activeCwd,
    repositoryRoot: input.repositoryRoot,
  });
  if (!workspaceFilePath) return { kind: "none" };

  if (input.threadRef) {
    return { kind: "open-in-files-panel", threadRef: input.threadRef, filePath: workspaceFilePath };
  }

  return {
    kind: "open-in-editor",
    targetPath: input.activeCwd
      ? resolvePathLinkTarget(workspaceFilePath, input.activeCwd)
      : workspaceFilePath,
  };
}
