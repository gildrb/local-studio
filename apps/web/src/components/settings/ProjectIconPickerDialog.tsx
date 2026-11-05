import { ProjectMonogram } from "../ProjectMonogram";
import { type ProjectIconColor, type ProjectIconOverride } from "@t3tools/contracts";
import { DynamicIcon } from "lucide-react/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { PROJECT_ICON_COLORS } from "../../projectIconColors";
import { PROJECT_ICON_CATALOG } from "../../projectIconCatalog";
import { firstEmoji, projectIconColorClassName } from "../../projectIconOptions";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  buildProjectIconPickerModel,
  resolveProjectIconPickerInitialState,
  resolveProjectIconPickerMode,
  resolveProjectIconPickerSave,
  type ProjectIconMode,
} from "./ProjectIconPickerDialog.logic";

export function ProjectIconPickerDialog({
  current,
  projectName,
  open,
  onOpenChange,
  onSelect,
}: {
  readonly current: ProjectIconOverride | null;
  readonly projectName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (icon: ProjectIconOverride) => void;
}) {
  const initial = resolveProjectIconPickerInitialState(current, projectName);
  const [mode, setMode] = useState<ProjectIconMode>(initial.mode);
  const [iconName, setIconName] = useState(initial.iconName);
  const [color, setColor] = useState<ProjectIconColor>(initial.color);
  const [letters, setLetters] = useState(initial.letters);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [query, setQuery] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  const previousOpenRef = useRef(false);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      const next = resolveProjectIconPickerInitialState(current, projectName);
      setMode(next.mode);
      setIconName(next.iconName);
      setColor(next.color);
      setLetters(next.letters);
      setEmoji(next.emoji);
      setQuery("");
      setCustomEmoji("");
    }
    previousOpenRef.current = open;
  }, [current, open, projectName]);

  const model = useMemo(
    () =>
      buildProjectIconPickerModel({
        projectName,
        state: { mode, iconName, color, letters, emoji },
        query,
        iconCatalog: PROJECT_ICON_CATALOG,
      }),
    [projectName, mode, iconName, color, letters, emoji, query],
  );
  const selectedColorClassName = projectIconColorClassName(color);
  const save = () => {
    const decision = resolveProjectIconPickerSave({ mode, iconName, color, letters, emoji });
    if (decision.kind === "invalid") return;
    onSelect(decision.icon);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full sm:w-[32rem]">
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          <ToggleGroup
            aria-label={model.modeAriaLabel}
            variant="segmented"
            value={[model.mode]}
            onValueChange={(next) => {
              const value = resolveProjectIconPickerMode(next[0]);
              if (value) setMode(value);
            }}
          >
            {model.modeOptions.map((option) => (
              <Toggle key={option.value} value={option.value}>
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>

          {model.colors ? (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {model.colors.label}
              </div>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label={model.colors.ariaLabel}
              >
                {model.colors.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={option.selected}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      option.selected && "border-foreground/64",
                    )}
                    onClick={() => setColor(option.value)}
                  >
                    <span
                      className={cn(
                        "size-4 rounded-full",
                        PROJECT_ICON_COLORS.find((candidate) => candidate.value === option.value)
                          ?.swatchClassName,
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {model.icons ? (
            <>
              <Input
                type="search"
                value={query}
                aria-label={model.icons.searchAriaLabel}
                placeholder={model.icons.searchPlaceholder}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <ScrollArea scrollFade className="max-h-64">
                <div className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10">
                  {model.icons.icons.map((icon) => (
                    <button
                      key={icon.name}
                      type="button"
                      aria-label={icon.label}
                      aria-pressed={icon.selected}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        icon.selected && "border-border bg-accent",
                        selectedColorClassName,
                      )}
                      onClick={() => setIconName(icon.name)}
                    >
                      <DynamicIcon name={icon.name} className="size-5" />
                    </button>
                  ))}
                </div>
              </ScrollArea>
              {model.icons.emptyLabel ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {model.icons.emptyLabel}
                </p>
              ) : null}
            </>
          ) : model.monogram ? (
            <div className="flex items-center gap-4 py-2">
              <ProjectMonogram
                text={model.monogram.previewText}
                color={model.monogram.color}
                className="size-12"
              />
              <div className="flex-1 space-y-2">
                <label htmlFor={model.monogram.inputId} className="text-sm font-medium">
                  {model.monogram.label}
                </label>
                <Input
                  id={model.monogram.inputId}
                  value={letters}
                  onChange={(event) => setLetters(event.currentTarget.value)}
                  aria-describedby={model.monogram.hintId}
                  aria-invalid={!model.monogram.valid}
                  autoComplete="off"
                />
                <p id={model.monogram.hintId} className="text-xs text-muted-foreground">
                  {model.monogram.hint}
                </p>
              </div>
            </div>
          ) : model.emojis ? (
            <>
              <ScrollArea scrollFade className="max-h-64">
                <div className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10">
                  {model.emojis.options.map((option) => (
                    <button
                      key={option.emoji}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={option.selected}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent text-xl outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        option.selected && "border-border bg-accent",
                      )}
                      onClick={() => setEmoji(option.emoji)}
                    >
                      {option.emoji}
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  {model.emojis.customLabel}
                </div>
                <Input
                  value={customEmoji}
                  aria-label={model.emojis.customAriaLabel}
                  placeholder={model.emojis.customPlaceholder}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCustomEmoji(value);
                    const nextEmoji = firstEmoji(value);
                    if (nextEmoji) setEmoji(nextEmoji);
                  }}
                />
              </div>
            </>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {model.cancelLabel}
          </Button>
          <Button onClick={save} disabled={model.saveDisabled}>
            {model.saveLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
