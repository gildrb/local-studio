"use client";

import { PipetteIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hexToHsv, hsvToHex, type HsvColor } from "../../lib/color";
import { ColorHueSlider, ColorSaturationValuePlane } from "../ui/color-picker";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";
import {
  buildProviderAccentColorPickerModel,
  resolveProviderAccentChange,
  resolveProviderAccentHexInput,
  type ProviderAccentColorPickerModel,
} from "./ProviderAccentColorPicker.logic";

function ProviderCustomColorPanel(props: {
  readonly model: ProviderAccentColorPickerModel;
  readonly value: string;
  readonly onCommit: (value: string) => void;
}) {
  const { onCommit } = props;
  const [hsv, setHsv] = useState(() => hexToHsv(props.value));
  const currentColor = hsvToHex(hsv.h, hsv.s, hsv.v);
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  const commitHsv = useCallback(
    (nextHsv: HsvColor) => {
      setHsv(nextHsv);
      onCommit(hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v));
    },
    [onCommit],
  );

  return (
    <div className="w-56 bg-popover">
      <ColorSaturationValuePlane
        label={props.model.planeLabel}
        value={hsv}
        onChange={commitHsv}
        variant="edge"
      />
      <div className="grid gap-3 p-3">
        <ColorHueSlider
          label={props.model.hueLabel}
          value={hsv.h}
          onChange={(h) => commitHsv({ ...hsv, h })}
        />
        <Input
          nativeInput
          size="compact"
          value={hexDraft ?? currentColor}
          onChange={(event) => {
            const nextColor = event.currentTarget.value;
            setHexDraft(nextColor);
            const committedColor = resolveProviderAccentHexInput(nextColor);
            if (committedColor === null) return;
            setHsv(hexToHsv(committedColor));
            props.onCommit(committedColor);
          }}
          onBlur={() => setHexDraft(null)}
          font="mono"
          aria-label={props.model.hexInputAriaLabel}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function ProviderCustomColorPicker(props: {
  readonly model: ProviderAccentColorPickerModel;
  readonly onCommit: (value: string) => void;
  readonly onClear: () => void;
}) {
  const { model } = props;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input text-white shadow-xs transition-transform duration-200 active:scale-95",
              "hover:scale-105 hover:border-ring/60",
            )}
            style={{ backgroundColor: model.swatchColor }}
            aria-label={model.triggerAriaLabel}
          >
            <PipetteIcon className="size-3 text-white/70 drop-shadow-sm" aria-hidden />
          </button>
        }
      />
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="none">
        <ProviderCustomColorPanel
          model={model}
          value={model.swatchColor}
          onCommit={props.onCommit}
        />
        <div className="border-t border-border/60 p-1">
          <PopoverClose
            render={
              <Button
                type="button"
                size="compact"
                variant="ghost-muted"
                className="w-full justify-start"
                onClick={props.onClear}
                disabled={model.clearDisabled}
              >
                <XIcon aria-hidden />
                {model.clearLabel}
              </Button>
            }
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function ProviderAccentColorPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly onCommit: (value: string) => void;
  readonly description?: string;
  readonly commitDelayMs?: number;
  /** `inline` renders only the swatch row, for callers that supply their own label. */
  readonly layout?: "stacked" | "inline";
}) {
  const {
    commitDelayMs = 0,
    description,
    displayName,
    layout = "stacked",
    onCommit,
    value,
  } = props;
  const [optimisticValue, setOptimisticValue] = useState(() => value ?? "");
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (pendingCommitRef.current !== null) return;
    setOptimisticValue(value ?? "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      const pendingCommit = pendingCommitRef.current;
      if (pendingCommit !== null) {
        onCommitRef.current(pendingCommit);
      }
    };
  }, []);

  const commitAccentColor = useCallback(
    (value: string) => {
      const normalizedValue = resolveProviderAccentChange(value);
      setOptimisticValue(normalizedValue);

      if (commitDelayMs <= 0) {
        pendingCommitRef.current = null;
        if (commitTimeoutRef.current !== null) {
          clearTimeout(commitTimeoutRef.current);
          commitTimeoutRef.current = null;
        }
        onCommit(normalizedValue);
        return;
      }

      pendingCommitRef.current = normalizedValue;
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      commitTimeoutRef.current = setTimeout(() => {
        commitTimeoutRef.current = null;
        const pendingCommit = pendingCommitRef.current;
        pendingCommitRef.current = null;
        if (pendingCommit !== null) {
          onCommitRef.current(pendingCommit);
        }
      }, commitDelayMs);
    },
    [commitDelayMs, onCommit],
  );

  const model = useMemo(
    () =>
      buildProviderAccentColorPickerModel({
        displayName,
        value: optimisticValue,
        description,
        layout,
      }),
    [description, displayName, layout, optimisticValue],
  );
  const picker = (
    <ProviderCustomColorPicker
      model={model}
      onCommit={commitAccentColor}
      onClear={() => commitAccentColor("")}
    />
  );

  if (model.layout === "inline") {
    return picker;
  }

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-foreground">{model.label}</span>
      {picker}
      {model.description ? (
        <span className="text-xs text-muted-foreground">{model.description}</span>
      ) : null}
    </div>
  );
}
