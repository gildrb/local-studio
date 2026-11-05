import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";

import { isElectron } from "../../env";
import { usePrimarySessionState } from "../../environments/primary";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSessionState } from "../../state/session";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";
import {
  buildEnvironmentIconMenuModel,
  resolveEnvironmentIconSelection,
  resolveEnvironmentOperateAccess,
} from "./EnvironmentIconPicker.logic";

// Same split the provider settings use: the desktop app owns its primary
// server outright, a browser session on the primary checks its cookie
// session's scopes, and a remote checks the scopes its own server reports.
function useEnvironmentOperateAccess(environmentId: EnvironmentId) {
  const isPrimary = usePrimaryEnvironmentId() === environmentId;
  const primarySession = usePrimarySessionState();
  const remoteSession = useEnvironmentSessionState(environmentId);
  return resolveEnvironmentOperateAccess({
    isPrimary,
    isElectron,
    primarySession: {
      session: primarySession.data,
      isPending: primarySession.isPending,
      hasError: primarySession.error !== null,
    },
    remoteSession: {
      session: remoteSession.data,
      isPending: remoteSession.isPending,
      hasError: remoteSession.hasError,
    },
  });
}

/**
 * "Icon" submenu for an environment's row menu. Lists the machine kinds with
 * the server's own detection marked, so the user can tell whether detection
 * got it right before overriding. Picking the detected kind clears the
 * override. Locked environments show the reason as a disabled item instead of
 * hiding the submenu, so the current icon still reads.
 */
export function EnvironmentIconMenu({
  environmentId,
  serverConfig,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: ServerConfig | null;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const operateAccess = useEnvironmentOperateAccess(environmentId);
  const model = buildEnvironmentIconMenuModel({ serverConfig, operateAccess });

  return (
    <MenuSub>
      <MenuSubTrigger>
        <EnvironmentMachineIcon kind={model.icon} />
        {model.label}
      </MenuSubTrigger>
      <MenuSubPopup>
        {model.lock !== null ? (
          <>
            <MenuItem disabled className="whitespace-normal">
              {model.lock}
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuRadioGroup
          value={model.value}
          onValueChange={(next) => {
            const selection = resolveEnvironmentIconSelection({
              lock: model.lock,
              detected: model.detected,
              next,
            });
            if (selection.kind === "none") return;
            updateSettings(selection.patch);
          }}
        >
          {model.options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} disabled={option.disabled}>
              <span className="flex min-w-0 items-center gap-2">
                <EnvironmentMachineIcon kind={option.icon} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.badge !== null ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{option.badge}</span>
                ) : null}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
