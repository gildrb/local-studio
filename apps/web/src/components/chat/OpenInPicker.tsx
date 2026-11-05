import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenHint,
  useRemoteOpenState,
} from "../../remoteOpen";
import { useEnvironment } from "../../state/environments";
import { ChevronDownIcon, FolderClosedIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
  MenuTrigger,
} from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  FileExplorerIcon,
  FinderIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "../JetBrainsIcons";
import { cn } from "~/lib/utils";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  buildOpenInToolbarModel,
  resolveOpenInEditorIntent,
  resolveOpenInEffectiveEditors,
  resolveOpenInOptionModels,
  runOpenInEditorIntent,
  type OpenInIconId,
  type OpenInIconKind,
} from "./OpenInPicker.logic";

const OPEN_IN_ICONS: Record<OpenInIconId, Icon> = {
  cursor: CursorIcon,
  trae: TraeIcon,
  kiro: KiroIcon,
  vscode: VisualStudioCode,
  "vscode-insiders": VisualStudioCodeInsiders,
  vscodium: VSCodium,
  zed: Zed,
  antigravity: AntigravityIcon,
  idea: IntelliJIdeaIcon,
  aqua: AquaIcon,
  clion: CLionIcon,
  datagrip: DataGripIcon,
  dataspell: DataSpellIcon,
  goland: GoLandIcon,
  phpstorm: PhpStormIcon,
  pycharm: PyCharmIcon,
  rider: RiderIcon,
  rubymine: RubyMineIcon,
  rustrover: RustRoverIcon,
  webstorm: WebStormIcon,
  finder: FinderIcon,
  "file-explorer": FileExplorerIcon,
  "folder-closed": FolderClosedIcon,
};

export const resolveOpenInOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) =>
  resolveOpenInOptionModels(platform, availableEditors).map(({ value, label, icon, kind }) => ({
    label,
    Icon: OPEN_IN_ICONS[icon],
    value,
    kind,
  }));

function getOpenInIconClass(kind: OpenInIconKind) {
  return cn(kind === "brand" ? "text-foreground opacity-100" : "text-muted-foreground");
}

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  presentation = "toolbar",
  compact = false,
  enableShortcut = true,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  presentation?: "toolbar" | "menu";
  compact?: boolean;
  enableShortcut?: boolean;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const remote = useRemoteOpenState(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();
  const [remoteHintSeen, markRemoteHintSeen] = useRemoteOpenHint();
  const environmentLabel = useEnvironment(environmentId)?.label ?? null;
  // Remote mode ignores the server's PATH probe: what matters is what runs on
  // the viewing machine, which only the desktop app can probe.
  const effectiveEditors = resolveOpenInEffectiveEditors({
    remoteMode: remote.mode,
    availableEditors,
    remoteCapableEditors,
  });
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(effectiveEditors);
  const model = useMemo(
    () =>
      buildOpenInToolbarModel({
        platform: navigator.platform,
        effectiveEditors,
        preferredEditor,
        openInCwd,
        remoteMode: remote.mode,
        remoteHintSeen,
        environmentLabel,
        keybindings,
      }),
    [
      effectiveEditors,
      environmentLabel,
      keybindings,
      openInCwd,
      preferredEditor,
      remote.mode,
      remoteHintSeen,
    ],
  );
  const primaryOption = model.primary;
  const PrimaryIcon = primaryOption ? OPEN_IN_ICONS[primaryOption.icon] : null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) =>
      runOpenInEditorIntent(
        resolveOpenInEditorIntent({ editorId, preferredEditor, openInCwd, remote }),
        {
          openRemoteUrl: openRemoteEditorUrl,
          openLocal: ({ editor, cwd }) =>
            openInEditorMutation({ environmentId, input: { cwd, editor } }),
          markRemoteHintSeen,
          setPreferredEditor,
        },
      ),
    [
      environmentId,
      markRemoteHintSeen,
      openInCwd,
      openInEditorMutation,
      preferredEditor,
      remote,
      setPreferredEditor,
    ],
  );

  useEffect(() => {
    if (!enableShortcut) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void openInEditor(preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableShortcut, keybindings, openInCwd, openInEditor, preferredEditor]);

  const editorItems = (
    <>
      {model.menuItems.map((item) => {
        if (item.kind === "notice") {
          return (
            <MenuItem
              key={item.id}
              density={presentation === "menu" ? "touch" : "default"}
              disabled
            >
              {item.label}
            </MenuItem>
          );
        }
        const ItemIcon = OPEN_IN_ICONS[item.icon];
        return (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={item.id}
            onClick={() => openInEditor(item.id)}
          >
            <ItemIcon aria-hidden="true" className={getOpenInIconClass(item.iconKind)} />
            <MenuItemLabel>{item.label}</MenuItemLabel>
            {item.shortcutLabel && <MenuShortcut>{item.shortcutLabel}</MenuShortcut>}
          </MenuItem>
        );
      })}
    </>
  );
  if (presentation === "menu") {
    return (
      <>
        {primaryOption && PrimaryIcon && (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            disabled={model.primaryMenuItemDisabled}
            onClick={() => openInEditor(preferredEditor)}
          >
            <PrimaryIcon className={cn("size-4", getOpenInIconClass(primaryOption.kind))} />
            <MenuItemLabel>{model.primaryMenuLabel}</MenuItemLabel>
            {model.favoriteShortcutLabel && (
              <MenuShortcut>{model.favoriteShortcutLabel}</MenuShortcut>
            )}
          </MenuItem>
        )}
        <MenuSub>
          <MenuSubTrigger density="touch">
            <SquareArrowOutUpRightIcon className="size-4" />
            <MenuItemLabel>{model.submenuLabel}</MenuItemLabel>
          </MenuSubTrigger>
          <MenuSubPopup>{editorItems}</MenuSubPopup>
        </MenuSub>
      </>
    );
  }

  return (
    <Group aria-label={model.groupAriaLabel}>
      <Button
        aria-label={compact ? model.compactAriaLabel : undefined}
        size="xs"
        variant="outline"
        disabled={model.primaryButtonDisabled}
        onClick={() => openInEditor(preferredEditor)}
      >
        {primaryOption && PrimaryIcon && (
          <PrimaryIcon
            aria-hidden="true"
            className={cn("size-3.5", getOpenInIconClass(primaryOption.kind))}
          />
        )}
        <span
          className={
            compact
              ? "sr-only"
              : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5"
          }
        >
          {model.primaryButtonLabel}
        </span>
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={
            <Button aria-label={model.chooseEditorAriaLabel} size="icon-xs" variant="outline" />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">{editorItems}</MenuPopup>
      </Menu>
    </Group>
  );
});
