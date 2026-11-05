import {
  buildRemoteOpenUrl,
  type EditorId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import { editorLabelForPlatform } from "../../editorLabels";
import { shortcutLabelForCommand } from "../../keybindings";
import { isMacPlatform, isWindowsPlatform } from "../../lib/utils";
import type { RemoteOpenMode, RemoteOpenState } from "../../remoteOpen.logic";

export type OpenInIconId =
  | "cursor"
  | "trae"
  | "kiro"
  | "vscode"
  | "vscode-insiders"
  | "vscodium"
  | "zed"
  | "antigravity"
  | "idea"
  | "aqua"
  | "clion"
  | "datagrip"
  | "dataspell"
  | "goland"
  | "phpstorm"
  | "pycharm"
  | "rider"
  | "rubymine"
  | "rustrover"
  | "webstorm"
  | "finder"
  | "file-explorer"
  | "folder-closed";

export type OpenInIconKind = "brand" | "generic";

export interface OpenInOptionModel {
  readonly value: EditorId;
  readonly label: string;
  readonly icon: OpenInIconId;
  readonly kind: OpenInIconKind;
}

const BRAND_EDITOR_OPTIONS: ReadonlyArray<{
  readonly value: EditorId;
  readonly icon: OpenInIconId;
}> = [
  { value: "cursor", icon: "cursor" },
  { value: "trae", icon: "trae" },
  { value: "kiro", icon: "kiro" },
  { value: "vscode", icon: "vscode" },
  { value: "vscode-insiders", icon: "vscode-insiders" },
  { value: "vscodium", icon: "vscodium" },
  { value: "zed", icon: "zed" },
  { value: "antigravity", icon: "antigravity" },
  { value: "idea", icon: "idea" },
  { value: "aqua", icon: "aqua" },
  { value: "clion", icon: "clion" },
  { value: "datagrip", icon: "datagrip" },
  { value: "dataspell", icon: "dataspell" },
  { value: "goland", icon: "goland" },
  { value: "phpstorm", icon: "phpstorm" },
  { value: "pycharm", icon: "pycharm" },
  { value: "rider", icon: "rider" },
  { value: "rubymine", icon: "rubymine" },
  { value: "rustrover", icon: "rustrover" },
  { value: "webstorm", icon: "webstorm" },
];

export function resolveOpenInOptionModels(
  platform: string,
  availableEditors: ReadonlyArray<EditorId>,
): ReadonlyArray<OpenInOptionModel> {
  const isMac = isMacPlatform(platform);
  const isWindows = isWindowsPlatform(platform);
  const baseOptions: ReadonlyArray<Omit<OpenInOptionModel, "label">> = [
    ...BRAND_EDITOR_OPTIONS.map((option) => ({ ...option, kind: "brand" as const })),
    {
      value: "file-manager",
      icon: isMac ? "finder" : isWindows ? "file-explorer" : "folder-closed",
      kind: isMac || isWindows ? "brand" : "generic",
    },
  ];
  const availableEditorSet = new Set(availableEditors);
  return baseOptions
    .filter((option) => availableEditorSet.has(option.value))
    .map((option) => ({ ...option, label: editorLabelForPlatform(option.value, platform) }));
}

export function resolveOpenInEffectiveEditors(input: {
  readonly remoteMode: RemoteOpenMode;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly remoteCapableEditors: ReadonlyArray<EditorId>;
}): ReadonlyArray<EditorId> {
  return input.remoteMode === "local-exec" ? input.availableEditors : input.remoteCapableEditors;
}

export type OpenInMenuItemModel =
  | {
      readonly kind: "editor";
      readonly id: EditorId;
      readonly label: string;
      readonly icon: OpenInIconId;
      readonly iconKind: OpenInIconKind;
      readonly shortcutLabel: string | null;
    }
  | {
      readonly kind: "notice";
      readonly id: "no-ssh-route" | "no-editors" | "ssh-hint";
      readonly label: string;
    };

export interface OpenInToolbarInput {
  readonly platform: string;
  readonly effectiveEditors: ReadonlyArray<EditorId>;
  readonly preferredEditor: EditorId | null;
  readonly openInCwd: string | null;
  readonly remoteMode: RemoteOpenMode;
  readonly remoteHintSeen: boolean;
  readonly environmentLabel: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
}

export interface OpenInToolbarModel {
  readonly options: ReadonlyArray<OpenInOptionModel>;
  readonly primary: OpenInOptionModel | null;
  readonly primaryMenuLabel: string | null;
  readonly primaryButtonLabel: string;
  readonly primaryButtonDisabled: boolean;
  readonly primaryMenuItemDisabled: boolean;
  readonly compactAriaLabel: string;
  readonly favoriteShortcutLabel: string | null;
  readonly menuItems: ReadonlyArray<OpenInMenuItemModel>;
  readonly submenuLabel: string;
  readonly chooseEditorAriaLabel: string;
  readonly groupAriaLabel: string;
}

export function buildOpenInToolbarModel(input: OpenInToolbarInput): OpenInToolbarModel {
  const options = resolveOpenInOptionModels(input.platform, input.effectiveEditors);
  const primary = options.find(({ value }) => value === input.preferredEditor) ?? null;
  const favoriteShortcutLabel = shortcutLabelForCommand(
    input.keybindings,
    "editor.openFavorite",
    input.platform,
  );
  const environmentLabel = input.environmentLabel ?? "this machine";
  const remoteUnavailable = input.remoteMode === "remote-unavailable";
  const menuItems: OpenInMenuItemModel[] = [];
  if (remoteUnavailable) {
    menuItems.push({
      kind: "notice",
      id: "no-ssh-route",
      label: `No SSH route to ${environmentLabel}`,
    });
  } else {
    if (options.length === 0) {
      menuItems.push({ kind: "notice", id: "no-editors", label: "No installed editors found" });
    }
    for (const option of options) {
      menuItems.push({
        kind: "editor",
        id: option.value,
        label: option.label,
        icon: option.icon,
        iconKind: option.kind,
        shortcutLabel:
          option.value === input.preferredEditor && favoriteShortcutLabel
            ? favoriteShortcutLabel
            : null,
      });
    }
    if (input.remoteMode === "remote-links" && !input.remoteHintSeen) {
      menuItems.push({
        kind: "notice",
        id: "ssh-hint",
        label: `Opens over SSH. Needs your key on ${environmentLabel}`,
      });
    }
  }
  return {
    options,
    primary,
    primaryMenuLabel: primary ? `Open in ${primary.label}` : null,
    primaryButtonLabel: "Open",
    primaryButtonDisabled: !input.preferredEditor || !input.openInCwd || remoteUnavailable,
    primaryMenuItemDisabled: !input.openInCwd || remoteUnavailable,
    compactAriaLabel: "Open file in preferred editor",
    favoriteShortcutLabel,
    menuItems,
    submenuLabel: "Open in…",
    chooseEditorAriaLabel: "Choose editor",
    groupAriaLabel: "Open in editor",
  };
}

export type OpenInEditorIntent =
  | { readonly kind: "none" }
  | { readonly kind: "remote-url"; readonly editor: EditorId; readonly url: string }
  | { readonly kind: "local"; readonly editor: EditorId; readonly cwd: string };

export function resolveOpenInEditorIntent(input: {
  readonly editorId: EditorId | null;
  readonly preferredEditor: EditorId | null;
  readonly openInCwd: string | null;
  readonly remote: RemoteOpenState;
}): OpenInEditorIntent {
  if (!input.openInCwd) return { kind: "none" };
  const editor = input.editorId ?? input.preferredEditor;
  if (!editor) return { kind: "none" };
  if (input.remote.mode === "remote-unavailable") return { kind: "none" };
  if (input.remote.mode === "remote-links") {
    const url = buildRemoteOpenUrl({
      editor,
      host: input.remote.host.host,
      absolutePath: input.openInCwd,
    });
    if (url === undefined) return { kind: "none" };
    return { kind: "remote-url", editor, url };
  }
  return { kind: "local", editor, cwd: input.openInCwd };
}

export interface OpenInEditorEffects<R> {
  readonly openRemoteUrl: (url: string) => Promise<boolean>;
  readonly openLocal: (input: { readonly editor: EditorId; readonly cwd: string }) => R;
  readonly markRemoteHintSeen: () => void;
  readonly setPreferredEditor: (editor: EditorId) => void;
}

export function runOpenInEditorIntent<R>(
  intent: OpenInEditorIntent,
  effects: OpenInEditorEffects<R>,
): R | undefined {
  if (intent.kind === "none") return undefined;
  if (intent.kind === "remote-url") {
    // Only record hint-seen/preferred when the shell actually accepted
    // the URL (an older desktop build can refuse the editor scheme).
    void effects.openRemoteUrl(intent.url).then((opened) => {
      if (!opened) return;
      effects.markRemoteHintSeen();
      effects.setPreferredEditor(intent.editor);
    });
    return undefined;
  }
  const result = effects.openLocal({ editor: intent.editor, cwd: intent.cwd });
  effects.setPreferredEditor(intent.editor);
  return result;
}
