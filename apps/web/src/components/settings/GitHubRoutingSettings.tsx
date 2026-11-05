import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import type { EnvironmentPresentation } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { EnvironmentRow } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import {
  buildGitHubRoutingSettingsModel,
  resolveGitHubRoutingChange,
} from "./GitHubRoutingSettings.logic";

/**
 * Folded section under the environments list. One row per switched-on machine
 * with how much of its GitHub access the other machines may use. The trust
 * warning is the first line of the body so it sits next to the control.
 * Rendered only when two or more machines are on.
 */
export function GitHubRoutingSettings({
  environments,
}: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const permissions = useAtomValue(environmentCatalog.githubRoutingPermissionsValueAtom);
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const update = useAtomCommand(environmentCatalog.setGitHubRoutingPermission);
  const [saving, setSaving] = useState(false);
  const model = useMemo(
    () =>
      buildGitHubRoutingSettingsModel({
        environments,
        permissions,
        catalogReady: catalog.isReady,
        saving,
      }),
    [environments, permissions, catalog.isReady, saving],
  );

  if (model === null) return null;

  return (
    <FoldedSettingsSection id={model.id} title={model.title} summary={model.summary}>
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">{model.description}</p>
      {model.rows.map((row) => (
        <EnvironmentRow key={row.id} kind={row.kind} label={row.label} subtitle={row.subtitle}>
          <Select
            items={row.options}
            value={row.value}
            disabled={row.disabled}
            onValueChange={(permission) => {
              const change = resolveGitHubRoutingChange({ environmentId: row.id, permission });
              if (change.kind === "none") return;
              setSaving(true);
              void update({
                environmentId: change.environmentId,
                permission: change.permission,
              }).then((result) => {
                setSaving(false);
                if (result._tag === "Failure")
                  toastManager.add({
                    type: "error",
                    title: change.failureToastTitle,
                  });
              });
            }}
          >
            <SelectTrigger size="xs" className="w-32" aria-label={row.ariaLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {row.options.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
