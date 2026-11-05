import type { ProjectEntry } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";

import { getLocalFileManagerName, isWindowsPlatform } from "../../lib/utils";
import { getProjectFilePickerMatches } from "../files/ProjectFilePicker.logic";

export type ProjectFaviconPickerFile = {
  readonly value: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly searchTerms: readonly string[];
};

export type ProjectFaviconPickerExternalAction = {
  readonly label: string;
  readonly disabled: boolean;
};

export type ProjectFaviconPickerModelInput = {
  readonly query: string;
  readonly entries: ReadonlyArray<ProjectEntry>;
  readonly matchedQuery: string;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly platform: string;
  readonly hasExternalPicker: boolean;
  readonly isPickingExternal: boolean;
  readonly projectName: string;
};

export type ProjectFaviconPickerModel = {
  readonly title: string;
  readonly escapeLabel: string;
  readonly footerActionLabel: string;
  readonly placeholder: string;
  readonly groupValue: string;
  readonly groupLabel: string;
  readonly files: readonly ProjectFaviconPickerFile[];
  readonly emptyStateMessage: string;
  readonly externalAction: ProjectFaviconPickerExternalAction | null;
};

export type ProjectFaviconPickerFailureToast = {
  readonly type: "error";
  readonly title: string;
  readonly description: string;
};

export function canPickExternalProjectFavicon(cwd: string, platform: string): boolean {
  return !isWindowsPlatform(platform) || isWindowsAbsolutePath(cwd);
}

function emptyMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  if (isPending) return query.trim() ? "Searching project files…" : "Indexing project files…";
  return query.trim() ? "No matching image files." : "No image files found.";
}

export function buildProjectFaviconPickerFiles(
  entries: ReadonlyArray<ProjectEntry>,
  matchedQuery: string,
): readonly ProjectFaviconPickerFile[] {
  return getProjectFilePickerMatches(entries, matchedQuery).map((match) => ({
    value: `project-favicon:${match.path}`,
    path: match.path,
    title: match.name,
    description: match.path,
    searchTerms: [match.name, match.path],
  }));
}

export function buildProjectFaviconPickerModel(
  input: ProjectFaviconPickerModelInput,
): ProjectFaviconPickerModel {
  return {
    title: "Choose project icon",
    escapeLabel: "Close",
    footerActionLabel: "Select icon",
    placeholder: "Search image files…",
    groupValue: "project-favicon-files",
    groupLabel: input.projectName,
    files: buildProjectFaviconPickerFiles(input.entries, input.matchedQuery),
    emptyStateMessage: emptyMessage(input.query, input.error, input.isPending),
    externalAction: input.hasExternalPicker
      ? {
          label: `Open in ${getLocalFileManagerName(input.platform)}`,
          disabled: input.isPickingExternal,
        }
      : null,
  };
}

export function resolveProjectFaviconPickerFailure(
  error: unknown,
): ProjectFaviconPickerFailureToast {
  return {
    type: "error",
    title: "Could not open image picker",
    description: error instanceof Error ? error.message : "An error occurred.",
  };
}
