import type { ServerSettings } from "@t3tools/contracts";
import { CheckIcon, LayersIcon } from "lucide-react";
import { useMemo } from "react";

import { cn } from "../../lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button, InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ProjectOverrideEntry, ScopedSettingsTarget } from "./scopedSettings";
import {
  buildSettingInheritanceModel,
  resolveSettingInheritanceReset,
  type SettingInheritanceEnvironment,
  type SettingInheritanceState,
} from "./SettingInheritance.logic";

/**
 * A small indicator beside a row's title that opens a top-down view of where
 * the setting's value comes from on each selected target. It sits inline so
 * narrowing to a project does not add a caption line to every row.
 */
export interface SettingOverridingProject extends ProjectOverrideEntry {
  readonly label: string;
  /** Jumps the breadcrumb to this project so its override can be edited. */
  readonly open: () => void;
}

const EMPTY_OVERRIDING_PROJECTS: readonly SettingOverridingProject[] = [];

export function SettingInheritance({
  state,
  summary,
  targets,
  environments,
  keys,
  overridingProjects = EMPTY_OVERRIDING_PROJECTS,
  onClearOverrides,
}: {
  state: SettingInheritanceState;
  summary: string;
  targets: readonly ScopedSettingsTarget[];
  environments: readonly SettingInheritanceEnvironment[];
  keys: readonly (keyof ServerSettings)[];
  /** At environment scope: projects whose own value hides the environment's. */
  overridingProjects?: readonly SettingOverridingProject[];
  onClearOverrides?: (entries: readonly ProjectOverrideEntry[]) => void;
}) {
  const canClearOverrides = onClearOverrides !== undefined;
  const model = useMemo(
    () =>
      buildSettingInheritanceModel({
        state,
        summary,
        targets,
        environments,
        keys,
        overridingProjects,
        canClearOverrides,
      }),
    [canClearOverrides, environments, keys, overridingProjects, state, summary, targets],
  );
  if (!model.visible) return null;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={model.triggerAriaLabel}
                />
              }
            />
          }
        >
          <LayersIcon
            className={cn(
              "size-3",
              model.tone === "primary" && "text-primary",
              model.tone === "warning" && "text-warning",
            )}
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{model.summary}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" width="md" padding="none">
        <div className="divide-y divide-border/60">
          {model.chains.map((chain) => (
            <section key={chain.id} className="px-3 py-2.5">
              <h4 className="flex items-center gap-1.5 pb-1.5 text-xs font-medium text-muted-foreground">
                <EnvironmentMachineIcon
                  aria-hidden
                  kind={chain.machine}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 truncate">{chain.title}</span>
              </h4>
              <ol role="list" className="text-sm">
                {chain.layers.map((layer) => (
                  <li
                    key={layer.key}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1",
                      layer.effective && "bg-foreground/[0.06]",
                    )}
                  >
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        layer.effective ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {layer.label}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 tabular-nums",
                        layer.effective
                          ? "text-foreground"
                          : layer.set
                            ? "text-muted-foreground"
                            : "text-muted-foreground/60",
                      )}
                    >
                      <span className="max-w-32 truncate">{layer.value}</span>
                      {layer.effective ? (
                        <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span aria-hidden className="size-3.5 shrink-0" />
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              {chain.overrides === null ? null : (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <div className="flex items-center justify-between gap-3 px-2 text-xs text-muted-foreground">
                    <span>{chain.overrides.heading}</span>
                    {onClearOverrides && chain.overrides.resetLabel !== null ? (
                      <InlineButton
                        onClick={() => {
                          const reset = resolveSettingInheritanceReset({
                            environmentId: chain.environmentId,
                            overridingProjects,
                          });
                          if (reset.kind === "clear-project-overrides")
                            onClearOverrides(reset.entries);
                        }}
                      >
                        {chain.overrides.resetLabel}
                      </InlineButton>
                    ) : null}
                  </div>
                  <ul role="list" className="mt-0.5 text-sm">
                    {chain.overrides.projects.map((project) => (
                      <li
                        key={project.projectId}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-1"
                      >
                        <InlineButton
                          className="min-w-0 justify-start"
                          onClick={() =>
                            overridingProjects
                              .find(
                                (candidate) =>
                                  candidate.environmentId === project.environmentId &&
                                  candidate.projectId === project.projectId,
                              )
                              ?.open()
                          }
                        >
                          <span className="truncate">{project.label}</span>
                        </InlineButton>
                        <span className="max-w-32 truncate text-muted-foreground tabular-nums">
                          {project.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
