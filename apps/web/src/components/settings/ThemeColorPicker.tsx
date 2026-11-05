import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ThemeColorRole } from "../../themePalette";
import { cn } from "../../lib/utils";
import { hexToHsv, hsvToHex, type HsvColor } from "../../lib/color";
import { ColorHueSlider, ColorSaturationValuePlane } from "../ui/color-picker";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildThemeColorFieldModel,
  buildThemeColorPickerModel,
  isThemePickerHexInput,
  normalizeThemePickerColor,
  themePickerAlphaSuffix,
  themeRgbToHex,
  themeRgbValue,
} from "./ThemeColorPicker.logic";

function ThemeColorPickerPanel({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const normalizedValue = normalizeThemePickerColor(value);
  const alphaSuffix = themePickerAlphaSuffix(value);
  const [hsv, setHsv] = useState(() => hexToHsv(normalizedValue));
  const [hexDraft, setHexDraft] = useState(normalizedValue);
  const [rgbDraft, setRgbDraft] = useState(() => themeRgbValue(normalizedValue));
  const isEditingTextRef = useRef(false);
  const currentColor = hsvToHex(hsv.h, hsv.s, hsv.v);
  const currentRgb = themeRgbValue(currentColor);
  const model = buildThemeColorPickerModel(label);

  useEffect(() => {
    // While a text field is focused, the incoming value may be the guided
    // editor's readability-adjusted echo of what is being typed; rewriting the
    // draft would fight the keystrokes. The swatch still tracks via hsv.
    if (!isEditingTextRef.current) {
      setHexDraft(normalizedValue);
      setRgbDraft(themeRgbValue(normalizedValue));
    }
    // Keep the current hue/saturation when the incoming value is just our own
    // change echoed back; hex → HSV is lossy for greys, white, and black.
    setHsv((current) =>
      hsvToHex(current.h, current.s, current.v) === normalizedValue
        ? current
        : hexToHsv(normalizedValue),
    );
  }, [normalizedValue]);

  // Local state updates immediately for a smooth thumb; the parent commit
  // (which can regenerate a whole guided palette) is batched to one call per
  // animation frame.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pendingCommitRef = useRef<string | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  // The final drag frame must not be lost when the popover closes or the
  // pointer lifts before the animation frame fires.
  const flushPendingCommit = useCallback(() => {
    if (commitFrameRef.current !== null) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    const pending = pendingCommitRef.current;
    pendingCommitRef.current = null;
    if (pending !== null) onChangeRef.current(pending);
  }, []);
  useEffect(() => () => flushPendingCommit(), [flushPendingCommit]);
  const scheduleCommit = useCallback((color: string) => {
    pendingCommitRef.current = color;
    commitFrameRef.current ??= requestAnimationFrame(() => {
      commitFrameRef.current = null;
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      if (pending !== null) onChangeRef.current(pending);
    });
  }, []);

  const commitHsv = useCallback(
    (nextHsv: HsvColor) => {
      setHsv(nextHsv);
      const nextColor = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
      setHexDraft(nextColor);
      setRgbDraft(themeRgbValue(nextColor));
      scheduleCommit(nextColor + alphaSuffix);
    },
    [alphaSuffix, scheduleCommit],
  );

  const handleHexChange = (nextValue: string) => {
    setHexDraft(nextValue);
    if (!isThemePickerHexInput(nextValue)) return;
    const nextHsv = hexToHsv(nextValue);
    setHsv(nextHsv);
    setRgbDraft(themeRgbValue(nextValue));
    onChange(nextValue.toLowerCase());
  };

  const handleRgbChange = (nextValue: string) => {
    setRgbDraft(nextValue);
    const nextColor = themeRgbToHex(nextValue);
    if (!nextColor) return;
    setHsv(hexToHsv(nextColor));
    setHexDraft(nextColor);
    // RGB cannot express alpha, so a commit keeps the incoming suffix just
    // like the plane and hue controls do.
    onChange(nextColor + alphaSuffix);
  };

  return (
    <div className="w-72 bg-popover">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{label}</p>
          <p className="text-2xs text-muted-foreground">{model.subtitle}</p>
        </div>
        <span
          className="size-7 shrink-0 rounded-full shadow-sm"
          style={{ backgroundColor: currentColor }}
        />
      </div>
      <div className="grid gap-3 px-3 pb-3 pt-3">
        <ColorSaturationValuePlane
          label={label}
          value={hsv}
          onChange={commitHsv}
          onInteractionEnd={flushPendingCommit}
        />
        <ColorHueSlider
          label={model.hueLabel}
          value={hsv.h}
          onChange={(h) => commitHsv({ ...hsv, h })}
          onInteractionEnd={flushPendingCommit}
        />
        <div className="grid grid-cols-[1fr_1.2fr] gap-2">
          <label className="grid min-w-0 gap-1">
            <span className="px-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
              {model.hexLabel}
            </span>
            <span className="flex min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2 focus-within:border-ring">
              <span
                className="size-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: currentColor }}
              />
              <input
                aria-label={model.hexAriaLabel}
                className="h-8 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
                onBlur={() => {
                  isEditingTextRef.current = false;
                  setHexDraft(currentColor);
                  setRgbDraft(currentRgb);
                }}
                onChange={(event) => handleHexChange(event.currentTarget.value)}
                onFocus={() => {
                  isEditingTextRef.current = true;
                }}
                spellCheck={false}
                value={hexDraft}
              />
            </span>
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="px-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
              {model.rgbLabel}
            </span>
            <span className="flex min-w-0 items-center rounded-lg border border-input bg-background px-2 focus-within:border-ring">
              <input
                aria-label={model.rgbAriaLabel}
                className="h-8 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
                onBlur={() => {
                  isEditingTextRef.current = false;
                  setHexDraft(currentColor);
                  setRgbDraft(currentRgb);
                }}
                onChange={(event) => handleRgbChange(event.currentTarget.value)}
                onFocus={() => {
                  isEditingTextRef.current = true;
                }}
                spellCheck={false}
                value={rgbDraft}
              />
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

function ThemeColorPicker({
  label,
  value,
  onChange,
  onInteract,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInteract?: () => void;
}) {
  const model = buildThemeColorPickerModel(label);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  aria-label={model.triggerAriaLabel}
                  className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/30 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onFocus={onInteract}
                  onPointerDown={onInteract}
                  type="button"
                >
                  <span
                    className="absolute inset-0 rounded-full shadow-sm"
                    style={{ backgroundColor: value }}
                  />
                </button>
              }
            />
          }
        />
        <TooltipPopup side="top">{model.triggerTooltip}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align="end"
        padding="none"
        data-theme-editor-panel=""
        side="bottom"
        sideOffset={10}
      >
        <ThemeColorPickerPanel label={label} onChange={onChange} value={value} />
      </PopoverPopup>
    </Popover>
  );
}

export const ThemeColorField = memo(function ThemeColorField({
  role,
  value,
  onChange,
  onSelect,
  onToggleSelected,
  selected = false,
  label: customLabel,
}: {
  role: ThemeColorRole;
  value: string;
  onChange: (role: ThemeColorRole, value: string) => void;
  onSelect?: (role: ThemeColorRole) => void;
  onToggleSelected?: (role: ThemeColorRole) => void;
  selected?: boolean;
  label?: string;
}) {
  const model = buildThemeColorFieldModel({ role, value, selected, label: customLabel });
  const label = model.label;

  return (
    <div
      className={cn(
        "flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-[background-color,box-shadow]",
        selected && "bg-accent/60 inset-ring inset-ring-ring",
      )}
      data-theme-color-role={role}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={model.toggleAriaLabel}
              aria-pressed={selected}
              className="flex min-w-0 flex-1 cursor-pointer items-center rounded-md text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onToggleSelected?.(role)}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{model.toggleTooltip}</TooltipPopup>
      </Tooltip>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ThemeColorPicker
          label={label}
          onChange={(nextValue) => onChange(role, nextValue)}
          onInteract={() => onSelect?.(role)}
          value={model.swatchValue}
        />
        <Input
          aria-invalid={!model.valid}
          aria-label={model.hexAriaLabel}
          className="w-28 shrink-0"
          font="mono"
          id={model.inputId}
          nativeInput
          onChange={(event) => onChange(role, event.currentTarget.value)}
          onFocus={() => onSelect?.(role)}
          onPointerDown={() => onSelect?.(role)}
          size="compact"
          value={model.editorValue}
        />
      </div>
    </div>
  );
});
