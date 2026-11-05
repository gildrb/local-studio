"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { ProviderDriverKind, type EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ChatGptConnectionButton } from "./ChatGptConnectionButton";
import { ACPRegistryIcon, Gemini, GithubCopilotIcon, type Icon } from "../Icons";
import { Dialog } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { PROVIDER_DRIVER_ICONS } from "./providerDriverMeta";
import type { ProviderDriverIconKey } from "./providerDriverMeta.logic";
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import { WizardPanel, WizardPopup, WizardHeader, WizardFooter } from "../ui/wizard";
import {
  ADD_PROVIDER_WIZARD_STEPS,
  buildAddProviderInstanceModel,
  DEFAULT_ADD_PROVIDER_DRIVER,
  resolveAddProviderConfigDraftChange,
  resolveAddProviderDriverMeta,
  resolveAddProviderInstanceBack,
  resolveAddProviderInstanceSubmit,
  resolveWizardNavigation,
  type AddProviderComingSoonIconKey,
  type AddProviderConfigDrafts,
  type WizardNavigation,
} from "./AddProviderInstanceDialog.logic";
import { AddProviderInstanceWizardSteps } from "./AddProviderInstanceWizardSteps";
import { AddManagedCodexAccountDialog } from "./CodexSetupSection";

const ADD_PROVIDER_ICONS: Readonly<
  Record<ProviderDriverIconKey | AddProviderComingSoonIconKey, Icon>
> = {
  ...PROVIDER_DRIVER_ICONS,
  "github-copilot": GithubCopilotIcon,
  gemini: Gemini,
  "acp-registry": ACPRegistryIcon,
};

interface AddProviderInstanceDialogProps {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onOpenChange: (open: boolean) => void;
}

export function AddProviderInstanceDialog({
  open,
  environmentId,
  environmentLabel,
  onOpenChange,
}: AddProviderInstanceDialogProps) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);

  const [wizardStep, setWizardStep] = useState(0);
  const [addingChatGptAccount, setAddingChatGptAccount] = useState(false);
  const [driver, setDriver] = useState<ProviderDriverKind>(DEFAULT_ADD_PROVIDER_DRIVER);
  const [label, setLabel] = useState("");
  const [accentColor, setAccentColor] = useState<string>("");
  const [instanceIdOverride, setInstanceIdOverride] = useState<string | null>(null);
  // Driver-specific config drafts keyed by driver so toggling between drivers
  // during the same dialog session does not lose in-progress input.
  const [configByDriver, setConfigByDriver] = useState<AddProviderConfigDrafts>({});
  // Errors are suppressed until the user has tried to submit once. After that
  // they update live so fixing the problem clears the message in place.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const model = buildAddProviderInstanceModel({
    environmentLabel,
    wizardStep,
    driver,
    label,
    accentColor,
    instanceIdOverride,
    existingInstanceIds: Object.keys(settings.providerInstances ?? {}),
    configByDriver,
    hasAttemptedSubmit,
  });
  const instanceIdError = model.submit.disabledReason;

  const setConfigDraft = (config: Record<string, unknown> | undefined) => {
    setConfigByDriver((existing) => resolveAddProviderConfigDraftChange(existing, driver, config));
  };

  const applyWizardNavigation = (navigation: WizardNavigation) => {
    if (navigation.kind === "blocked") {
      setHasAttemptedSubmit(true);
    }
    setWizardStep(navigation.step);
  };

  const navigateToStep = (requestedStep: number) => {
    applyWizardNavigation(
      resolveWizardNavigation(wizardStep, requestedStep, ADD_PROVIDER_WIZARD_STEPS.length, {
        instanceIdError,
      }),
    );
  };

  const handleSave = () => {
    setHasAttemptedSubmit(true);
    const submit = resolveAddProviderInstanceSubmit({
      driver,
      label,
      accentColor,
      instanceIdOverride,
      configByDriver,
      providerInstances: settings.providerInstances ?? {},
    });
    if (submit.kind === "invalid") return;
    try {
      updateSettings({ providerInstances: submit.providerInstances });
      toastManager.add({
        type: "success",
        title: submit.successToast.title,
        description: submit.successToast.description,
      });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: submit.failureToast.title,
        description:
          error instanceof Error ? error.message : submit.failureToast.fallbackDescription,
      });
    }
  };

  if (addingChatGptAccount) {
    return (
      <AddManagedCodexAccountDialog
        environmentId={environmentId}
        onClose={() => onOpenChange(false)}
      />
    );
  }

  const { driverField, labelField, instanceIdField, accentField, config, footer } = model;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WizardPopup size="wide">
        <WizardHeader title={model.title} description={model.description}>
          <AddProviderInstanceWizardSteps
            currentStep={wizardStep}
            summaries={model.stepSummaries}
            instanceIdError={instanceIdError}
            onNavigation={applyWizardNavigation}
          />
        </WizardHeader>

        <WizardPanel>
          <div className={cn("grid gap-2", !driverField.visible && "hidden")}>
            <div id={driverField.id} className="text-sm font-medium text-foreground">
              {driverField.label}
            </div>
            <RadioGroup
              value={driverField.value}
              onValueChange={(value) => setDriver(ProviderDriverKind.make(value))}
              aria-labelledby={driverField.id}
              className="grid grid-cols-1 sm:grid-cols-2"
            >
              {driverField.options.map((option) => {
                const IconComponent = ADD_PROVIDER_ICONS[option.iconKey];
                return option.disabled ? (
                  <RadioPrimitive.Root
                    key={option.value}
                    value={option.value}
                    disabled
                    className={cn(
                      "relative flex cursor-not-allowed items-center gap-3 rounded-lg bg-card/60 px-3 py-3 text-left opacity-64 outline-none ring-1 ring-black/5 dark:bg-white/2 dark:ring-white/5",
                    )}
                  >
                    <IconComponent className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    <Badge variant="warning" size="sm">
                      {option.badgeLabel}
                    </Badge>
                  </RadioPrimitive.Root>
                ) : (
                  <RadioPrimitive.Root
                    key={option.value}
                    value={option.value}
                    className="relative flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3 py-3 text-left text-muted-foreground outline-none ring-1 ring-black/5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary/8 data-checked:text-foreground data-checked:ring-2 data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15"
                  >
                    <IconComponent className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    <RadioPrimitive.Indicator
                      className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                      aria-hidden
                    >
                      <CheckIcon className="size-3.5 shrink-0" />
                    </RadioPrimitive.Indicator>
                    {option.badgeLabel ? (
                      <Badge variant="warning" size="sm">
                        {option.badgeLabel}
                      </Badge>
                    ) : null}
                  </RadioPrimitive.Root>
                );
              })}
            </RadioGroup>
          </div>

          <label className={cn("grid gap-2", !labelField.visible && "hidden")}>
            <span className="text-xs font-medium text-foreground">{labelField.label}</span>
            <Input
              placeholder={labelField.placeholder}
              value={labelField.value}
              onChange={(event) => setLabel(event.target.value)}
            />
            <span className="text-2xs text-muted-foreground">{labelField.hint}</span>
          </label>

          <label className={cn("grid gap-2", !instanceIdField.visible && "hidden")}>
            <span className="text-xs font-medium text-foreground">{instanceIdField.label}</span>
            <Input
              placeholder={instanceIdField.placeholder}
              value={instanceIdField.value}
              onChange={(event) => {
                setInstanceIdOverride(event.target.value);
              }}
              aria-invalid={instanceIdField.invalid}
            />
            {instanceIdField.invalid ? (
              <span className="text-2xs text-destructive">{instanceIdField.error}</span>
            ) : (
              <span className="text-2xs text-muted-foreground">{instanceIdField.hint}</span>
            )}
          </label>

          <div className={cn("grid gap-2", !accentField.visible && "hidden")}>
            <span className="text-xs font-medium text-foreground">{accentField.label}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ProviderAccentColorPicker
                displayName={accentField.pickerDisplayName}
                value={accentField.value || undefined}
                onCommit={setAccentColor}
                layout="inline"
              />
              <div className="flex flex-wrap gap-1.5">
                {accentField.swatches.map((swatch) => (
                  <button
                    key={swatch.value}
                    type="button"
                    className={cn(
                      "size-6 cursor-pointer rounded-full border transition",
                      swatch.selected
                        ? "scale-110 border-foreground ring-2 ring-ring ring-offset-1 ring-offset-background"
                        : "border-black/10 hover:scale-105 dark:border-white/20",
                    )}
                    style={{ backgroundColor: swatch.value }}
                    onClick={() => setAccentColor(swatch.value)}
                    aria-label={swatch.label}
                  />
                ))}
              </div>
              {accentField.clearLabel ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => setAccentColor("")}
                >
                  {accentField.clearLabel}
                </Button>
              ) : null}
            </div>
            <span className="text-2xs text-muted-foreground">{accentField.hint}</span>
          </div>

          {config.hasFields ? (
            <div className={cn("grid gap-4", !config.visible && "hidden")}>
              <ProviderSettingsForm
                definition={resolveAddProviderDriverMeta(config.driver)}
                value={config.value}
                idPrefix={config.idPrefix}
                variant="dialog"
                onChange={setConfigDraft}
              />
            </div>
          ) : config.emptyMessage ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">{config.emptyMessage}</p>
            </div>
          ) : null}
        </WizardPanel>

        <WizardFooter>
          <Button
            variant={footer.back.kind === "cancel" ? "ghost-muted" : "outline"}
            onClick={() => {
              const back = resolveAddProviderInstanceBack(wizardStep);
              if (back.kind === "close") {
                onOpenChange(false);
                return;
              }
              setWizardStep(back.step);
            }}
          >
            {footer.back.label}
          </Button>
          {footer.primary.kind === "codex-choice" ? (
            <>
              <Button variant="outline" onClick={() => navigateToStep(1)}>
                {footer.primary.manualLabel}
              </Button>
              <ChatGptConnectionButton onClick={() => setAddingChatGptAccount(true)}>
                {footer.primary.chatGptLabel}
              </ChatGptConnectionButton>
            </>
          ) : footer.primary.kind === "next" ? (
            <Button onClick={() => navigateToStep(wizardStep + 1)}>{footer.primary.label}</Button>
          ) : (
            <Button onClick={handleSave}>{footer.primary.label}</Button>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
