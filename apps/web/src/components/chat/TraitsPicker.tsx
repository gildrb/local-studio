import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { memo, useCallback } from "react";
import { BrainIcon, ZapIcon } from "lucide-react";
import { UltrafastIcon } from "../Icons";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  type ComposerControlSize,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import {
  buildTraitsMenuModel,
  getTraitsSectionVisibility,
  resolveTraitsSelection,
  shouldRenderTraitsControls,
  buildTraitsTriggerDisplay,
  type ProviderOptions,
} from "./TraitsPicker.logic";

type TraitsPersistence =
  | {
      threadRef?: ScopedThreadRef;
      draftId?: DraftId;
      onModelOptionsChange?: never;
    }
  | {
      threadRef?: undefined;
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void;
    };

function DefaultBadge() {
  return (
    <Badge variant="outline" size="sm" className="min-w-0">
      Default
    </Badge>
  );
}

export interface TraitsMenuContentProps {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  modelOptions?: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  planModeEnabled: boolean;
  triggerClassName?: string;
  isComposerOwned?: boolean;
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  instanceId,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  planModeEnabled,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const updateModelOptions = useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      if ("onModelOptionsChange" in persistence) {
        persistence.onModelOptionsChange(nextOptions);
        return;
      }
      const threadTarget = persistence.threadRef ?? persistence.draftId;
      if (!threadTarget) {
        return;
      }
      setProviderModelOptions(threadTarget, provider, nextOptions, {
        ...(instanceId ? { instanceId } : {}),
        model,
        persistSticky: true,
      });
    },
    [instanceId, model, persistence, provider, setProviderModelOptions],
  );
  const visibility = getTraitsSectionVisibility({
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort,
    planModeEnabled,
  });
  const menu = buildTraitsMenuModel(visibility);
  const handleChange = (descriptorId: string, value: string) => {
    const result = resolveTraitsSelection({ visibility, prompt, descriptorId, value });
    if (result.prompt !== null) {
      onPromptChange(result.prompt);
    }
    if (result.modelOptions !== null) {
      updateModelOptions(result.modelOptions.next);
    }
  };

  if (menu === null) {
    return null;
  }

  if (menu.kind === "unavailable") {
    return (
      <>
        {menu.items.map((item, index) => (
          <div key={item.id}>
            {index > 0 ? <MenuDivider /> : null}
            <MenuGroup>
              <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
                {item.label}
              </div>
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{item.value}</div>
            </MenuGroup>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {menu.selects.map((section, index) => (
        <div key={section.id}>
          {index > 0 ? <MenuDivider /> : null}
          <MenuGroup>
            <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
              {section.label}
            </div>
            {section.notice !== null ? (
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{section.notice}</div>
            ) : null}
            <MenuRadioGroup
              value={section.selectedValue}
              onValueChange={(value) => handleChange(section.id, value)}
            >
              {section.options.map((option) => (
                <MenuRadioItem
                  key={option.id}
                  value={option.id}
                  hideIndicator
                  // Base UI keeps radio menus open by default. Close on pick so
                  // the traits menu behaves like the model picker.
                  closeOnClick
                  disabled={section.disabled}
                >
                  <span className="flex w-full min-w-0 flex-col">
                    <span className="flex w-full min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {option.label}
                        {option.isDefault ? (
                          <>
                            {" "}
                            <DefaultBadge />
                          </>
                        ) : null}
                      </span>
                    </span>
                    {option.description !== null ? (
                      <span className="max-w-56 text-pretty text-muted-foreground/80 text-xs">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      ))}
      {menu.booleans.map((section, index) => (
        <div key={section.id}>
          {index > 0 || menu.selects.length > 0 ? <MenuDivider /> : null}
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              {section.label}
            </div>
            <MenuRadioGroup
              value={section.selectedValue}
              onValueChange={(value) => handleChange(section.id, value)}
            >
              {section.options.map((option) => (
                <MenuRadioItem key={option.id} value={option.id} hideIndicator closeOnClick>
                  <span className="flex w-full min-w-0 items-center justify-between gap-3">
                    <span>{option.label}</span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      ))}
    </>
  );
});

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  instanceId,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  planModeEnabled,
  triggerClassName,
  isComposerOwned,
  size = "sm",
  hidden = false,
  ...persistence
}: TraitsMenuContentProps &
  TraitsPersistence & {
    size?: ComposerControlSize;
    hidden?: boolean;
  }) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const [isMenuOpen, setIsMenuOpen] = useComposerMenuState(hidden);
  const { descriptors, primarySelectDescriptor, ultrathinkPromptControlled } =
    getTraitsSectionVisibility({
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
      planModeEnabled,
    });
  if (
    !shouldRenderTraitsControls({
      provider,
      models,
      model,
      prompt,
      modelOptions,
      allowPromptInjectedEffort,
      planModeEnabled,
    })
  ) {
    return null;
  }

  const { label: triggerLabel, speedIcon } = buildTraitsTriggerDisplay({
    provider,
    descriptors,
    primarySelectDescriptorId: primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled,
  });
  const speedLabel = speedIcon === "ultrafast" ? "Ultrafast mode on" : "Fast mode on";
  const accessibleLabel = speedIcon ? `${triggerLabel}, ${speedLabel}` : triggerLabel;
  const fastModeIcon = speedIcon ? (
    <>
      <ComposerControlIcon
        icon={speedIcon === "ultrafast" ? UltrafastIcon : ZapIcon}
        size={size}
        className={cn(
          "fill-current opacity-80",
          size === "xs"
            ? "text-current"
            : provider === "claudeAgent"
              ? "text-[#d97757]"
              : "text-foreground",
        )}
      />
      <span className="sr-only">{speedLabel}</span>
    </>
  ) : null;

  const isCodexStyle = provider === "codex";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  aria-label={accessibleLabel}
                  data-composer-shortcut={isComposerOwned ? "composer.effort" : undefined}
                  size={size}
                  className={cn(
                    isCodexStyle
                      ? "min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap sm:max-w-48"
                      : "shrink-0 whitespace-nowrap",
                    triggerClassName,
                  )}
                />
              }
            />
          }
        >
          {isCodexStyle ? (
            // The label truncates itself; clipping the wrapper too would cut off
            // the chevron, whose negative end margin overhangs the wrapper edge.
            <span
              className={cn(
                "flex min-w-0 w-full items-center",
                size === "xs" ? "gap-1" : "gap-1.5",
              )}
            >
              {fastModeIcon ?? (
                <span
                  data-composer-control-compact-icon
                  className="pointer-events-none invisible absolute"
                >
                  <ComposerControlIcon icon={BrainIcon} size={size} />
                </span>
              )}
              <span data-composer-control-label className="min-w-0 truncate">
                {triggerLabel}
              </span>
              <ComposerControlChevron size={size} />
            </span>
          ) : (
            <>
              {fastModeIcon ?? (
                <span
                  data-composer-control-compact-icon
                  className="pointer-events-none invisible absolute"
                >
                  <ComposerControlIcon icon={BrainIcon} size={size} />
                </span>
              )}
              <span data-composer-control-label>{triggerLabel}</span>
              <ComposerControlChevron size={size} />
            </>
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">{accessibleLabel}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...(isComposerOwned ? composerFloatingLayerProps : {})}>
        <TraitsMenuContent
          provider={provider}
          {...(instanceId ? { instanceId } : {})}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          planModeEnabled={planModeEnabled}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  );
});
