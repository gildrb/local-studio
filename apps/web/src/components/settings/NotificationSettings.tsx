import { useState } from "react";

import { unlockNotificationAudio } from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  buildNotificationSettingsModel,
  resolveNotificationModeChange,
  resolveNotificationPermissionResult,
  type NotificationPermissionOutcome,
} from "./NotificationSettings.logic";
import { SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const model = buildNotificationSettingsModel({ mode, permissionMessage, requesting });

  return (
    <SettingsRow
      id={model.anchorId}
      title={model.title}
      description={model.description}
      control={
        <Select
          value={model.value}
          disabled={model.disabled}
          onValueChange={async (value) => {
            const change = resolveNotificationModeChange({
              value,
              notificationApiAvailable: typeof Notification !== "undefined",
              isSecureContext: window.isSecureContext,
            });
            if (change.kind === "ignore") return;
            setPermissionMessage(null);
            if (change.unlockAudio) unlockNotificationAudio();
            if (change.kind === "unsupported") {
              setPermissionMessage(change.message);
              return;
            }
            if (change.kind === "apply") {
              updateSettings(change.patch);
              return;
            }
            setRequesting(true);
            let outcome: NotificationPermissionOutcome;
            try {
              outcome = await Notification.requestPermission();
            } catch {
              outcome = "error";
            } finally {
              setRequesting(false);
            }
            const decision = resolveNotificationPermissionResult({ mode: change.mode, outcome });
            if (decision.kind === "message") {
              setPermissionMessage(decision.message);
              return;
            }
            updateSettings(decision.patch);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={model.ariaLabel}>
            <SelectValue>{model.valueLabel}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {model.options.map((option) => (
              <SelectItem key={option.value} hideIndicator value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
