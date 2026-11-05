import { useLocation } from "@tanstack/react-router";
import { ChevronDownIcon, LayersIcon } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironments } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { InlineButton } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import type { SettingsScopeSearch } from "./settingsScope";
import {
  buildSettingsScopeSentenceModel,
  resolveSettingsScopeChange,
  type SettingsScopeIcon,
  type SettingsScopeMenuModel,
} from "./SettingsScopeSentence.logic";

interface SettingsScopeMenuProps {
  readonly menu: SettingsScopeMenuModel;
  readonly value: SettingsScopeSearch;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly onChange: (next: SettingsScopeSearch) => void;
}

/**
 * "Applying settings for <project> across <environment>" at the top of a settings
 * page. The two pickers are the targets a change is written to. A project is
 * the same project on every environment, so the environment alone decides
 * where a project override is written.
 */
export function SettingsScopeSentence() {
  const scope = useOptionalSettingsScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  const model = useMemo(
    () =>
      scope === null
        ? null
        : buildSettingsScopeSentenceModel({
            pathname,
            search: scope.search,
            singleEnvironment: scope.singleEnvironment,
            groups: scope.groups,
            environments,
          }),
    [environments, pathname, scope],
  );
  if (scope === null || model === null || !model.visible) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 text-base text-muted-foreground sm:px-4">
      {/* Each connective stays with its picker so a wrap never strands "on". */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">{model.lead}</span>
        <ScopeMenu
          menu={model.project}
          value={scope.search}
          groups={scope.groups}
          onChange={scope.selectScope}
        />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">
          {/* A legacy checkout link names one environment without `machine`. */}
          {model.connective}
        </span>
        <ScopeMenu
          menu={model.environment}
          value={scope.search}
          groups={scope.groups}
          onChange={scope.selectScope}
        />
      </span>
    </p>
  );
}

function ScopeIcon({
  icon,
  groups,
  className,
}: {
  icon: SettingsScopeIcon | null;
  groups: readonly SidebarProjectSnapshot[];
  className: string;
}): ReactNode {
  if (icon === null) return null;
  if (icon.kind === "layers") return <LayersIcon aria-hidden className={className} />;
  if (icon.kind === "environment-machine") {
    return <EnvironmentMachineIcon aria-hidden kind={icon.machine} className={className} />;
  }
  const group = groups.find((candidate) => candidate.projectKey === icon.projectKey);
  return group ? <ProjectFavicon project={group} className={className} /> : null;
}

function ScopeMenu({ menu, value, groups, onChange }: SettingsScopeMenuProps) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={menu.ariaLabel}
        render={<InlineButton tone="picker" />}
        className="min-w-0 max-w-72"
      >
        <ScopeIcon icon={menu.icon} groups={groups} className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{menu.label}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={menu.value}
          onValueChange={(next) => {
            const change = resolveSettingsScopeChange({
              axis: menu.axis,
              search: value,
              value: next,
            });
            if (change.kind === "select") onChange(change.search);
          }}
        >
          {menu.options.map((option) => (
            <Fragment key={option.value}>
              <MenuRadioItem value={option.value}>
                <span className="flex min-w-0 items-center gap-2">
                  <ScopeIcon icon={option.icon} groups={groups} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.badge === null ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">{option.badge}</span>
                  )}
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
              {option.separatorAfter ? <MenuSeparator /> : null}
            </Fragment>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
