import { Button } from "../ui/button";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { SettingsPageContainer } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useEnvironments } from "../../state/environments";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";
import type { SettingsScopeNoticeTarget } from "./SettingsRouteLayout.logic";
import {
  buildSettingsScopeNoticeModel,
  resolveSettingsScopeNoticeSelection,
} from "./SettingsScopeNotice.logic";

/** Offer an explicit target change when a category has no settings at this scope. */
export function SettingsScopeNotice({
  children,
  target,
  targetId,
  eligibleEnvironmentIds,
}: {
  children: string;
  target: SettingsScopeNoticeTarget;
  targetId?: string;
  eligibleEnvironmentIds?: readonly EnvironmentId[] | null;
}) {
  const { selectScope, search } = useSettingsScope();
  const navigate = useNavigate({ from: "/settings" });
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  const groups = useSettingsProjectGroups();
  const model = useMemo(
    () =>
      buildSettingsScopeNoticeModel({
        message: children,
        target,
        eligibleEnvironmentIds: eligibleEnvironmentIds ?? null,
        search,
        groups,
        environments,
      }),
    [children, eligibleEnvironmentIds, environments, groups, search, target],
  );
  return (
    <SettingsPageContainer>
      <Alert role={model.role}>
        <AlertDescription>
          <p>{model.message}</p>
          <AlertAction className="flex-wrap">
            {model.choices.map((choice) => (
              <Button
                key={choice.id}
                size="sm-multiline"
                variant="outline"
                className="max-w-full break-all text-left"
                onClick={() => {
                  const selection = resolveSettingsScopeNoticeSelection({
                    search: choice.search,
                    targetId: targetId ?? null,
                    pathname,
                  });
                  if (selection.kind === "navigate")
                    void navigate({
                      to: selection.to,
                      search: () => selection.search,
                      hash: selection.hash,
                    });
                  else selectScope(selection.search);
                }}
              >
                {choice.label}
              </Button>
            ))}
          </AlertAction>
        </AlertDescription>
      </Alert>
    </SettingsPageContainer>
  );
}
