import {
  isModifierPairShortcut,
  type SnapShotModifier,
  type SnapShotShortcut,
} from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";

import {
  formatSnapShotShortcutLabel,
  parseDesktopSnapShotShortcut,
  snapShotShortcutKeyLabels,
} from "../../lib/snapShotShortcut";
import { keybindingFromKeyboardEvent } from "./KeybindingsSettings.logic";

const MODIFIER_FROM_KEY: Readonly<Record<string, SnapShotModifier>> = {
  Shift: "shift",
  Meta: "meta",
  OS: "meta",
  Control: "control",
  Alt: "alt",
  AltGraph: "alt",
};
const MODIFIER_CODES: Readonly<Record<SnapShotModifier, readonly [string, string]>> = {
  shift: ["ShiftLeft", "ShiftRight"],
  meta: ["MetaLeft", "MetaRight"],
  control: ["ControlLeft", "ControlRight"],
  alt: ["AltLeft", "AltRight"],
};

export const SNAP_SHOT_SHORTCUT_RECORDING_STATUS = "Press your shortcut. Esc cancels.";

export type SnapShotShortcutRecorderModelInput = {
  readonly shortcut: SnapShotShortcut;
  readonly shortcutLabel: string | null;
  readonly recording: boolean;
  readonly disabled: boolean;
  readonly allowModifierPairs: boolean;
  readonly platform: string;
};

export type SnapShotShortcutRecorderContent =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "keys";
      readonly shortcut: SnapShotShortcut;
      readonly keyLabels: readonly string[];
    };

export type SnapShotShortcutRecorderModel = {
  readonly ariaLabel: string;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly content: SnapShotShortcutRecorderContent;
};

export function buildSnapShotShortcutRecorderModel(
  input: SnapShotShortcutRecorderModelInput,
): SnapShotShortcutRecorderModel {
  const displayShortcut = input.shortcutLabel
    ? parseDesktopSnapShotShortcut(input.shortcutLabel)
    : input.shortcut;
  return {
    ariaLabel: displayShortcut
      ? `Record snapshot shortcut, currently ${formatSnapShotShortcutLabel(displayShortcut, input.platform)}`
      : "Change snapshot shortcut",
    pressed: input.recording,
    disabled: input.disabled,
    content: input.recording
      ? { kind: "text", text: "Press shortcut…" }
      : !displayShortcut
        ? { kind: "text", text: "Change shortcut" }
        : !input.allowModifierPairs && isModifierPairShortcut(displayShortcut)
          ? { kind: "text", text: "Choose shortcut" }
          : {
              kind: "keys",
              shortcut: displayShortcut,
              keyLabels: snapShotShortcutKeyLabels(displayShortcut, input.platform),
            },
  };
}

export type SnapShotShortcutKeyDownInput = {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly recording: boolean;
  readonly heldModifierCodes: readonly string[];
  readonly allowModifierPairs: boolean;
  readonly platform: string;
};

export type SnapShotShortcutKeyDownOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "cancel" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "record"; readonly shortcut: SnapShotShortcut };

export type SnapShotShortcutKeyDown = {
  readonly handled: boolean;
  readonly holdModifierCode: string | null;
  readonly outcome: SnapShotShortcutKeyDownOutcome;
};

const NOT_HANDLED: SnapShotShortcutKeyDown = {
  handled: false,
  holdModifierCode: null,
  outcome: { kind: "none" },
};

export function resolveSnapShotShortcutKeyDown(
  input: SnapShotShortcutKeyDownInput,
): SnapShotShortcutKeyDown {
  if (!input.recording || input.key === "Tab" || input.repeat) return NOT_HANDLED;
  if (input.key === "Escape") {
    return { handled: true, holdModifierCode: null, outcome: { kind: "cancel" } };
  }
  const modifier = MODIFIER_FROM_KEY[input.key];
  if (modifier) {
    const held = new Set(input.heldModifierCodes).add(input.code);
    const [left, right] = MODIFIER_CODES[modifier];
    if (!held.has(left) || !held.has(right)) {
      return { handled: true, holdModifierCode: input.code, outcome: { kind: "none" } };
    }
    return {
      handled: true,
      holdModifierCode: input.code,
      outcome: !input.allowModifierPairs
        ? { kind: "error", message: "Add a letter, number, or function key to your shortcut." }
        : {
            kind: "record",
            shortcut:
              modifier === "shift"
                ? { kind: "both-shift-keys" }
                : { kind: "modifier-pair", modifier },
          },
    };
  }
  const handled: SnapShotShortcutKeyDown = {
    handled: true,
    holdModifierCode: null,
    outcome: { kind: "none" },
  };
  if (!input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey) return handled;
  const binding = keybindingFromKeyboardEvent(input, input.platform);
  if (!binding) return handled;
  const shortcut = parseKeybindingShortcut(binding);
  if (!shortcut) return handled;
  return { handled: true, holdModifierCode: null, outcome: { kind: "record", shortcut } };
}

export function snapShotShortcutRecordingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not start shortcut recording.";
}
