import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { SettingsRow } from "./settingsLayout";
import {
  buildAddCodexAccountModel,
  resolveAddCodexAccountCreate,
} from "./AddCodexAccountDialog.logic";

export function AddCodexAccountDialog({
  environmentId,
  onClose,
  renderSetup,
  onAccountCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onAccountCreated?:
    | ((instanceId: ProviderInstanceId, displayName: string) => void)
    | undefined;
  readonly renderSetup: (instanceId: ProviderInstanceId, provider: ServerProvider) => ReactNode;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, "Add ChatGPT account");
  const [name, setName] = useState("Personal");
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  const connected = usesChatGptSharing(provider);
  const model = buildAddCodexAccountModel({
    name,
    instanceId,
    pending,
    providerHasSetup: Boolean(provider?.setup),
    connected,
  });
  const closeAfterConnection = useEffectEvent(onClose);
  useEffect(() => {
    // The destination snapshot confirms remote transfer as well as local sign-in.
    if (connected) closeAfterConnection();
  }, [connected]);

  const createAccount = async () => {
    // The ID is routing identity; the name is editable and need not be unique.
    const create = resolveAddCodexAccountCreate({
      name,
      pending,
      instanceSuffix: randomUUID(),
      providerInstances: settings.providerInstances,
    });
    if (create.kind === "none") return;
    setPending(true);
    const result = await update({
      environmentId,
      input: { patch: { providerInstances: create.providerInstances } },
    });
    if (result._tag === "Success") {
      if (onAccountCreated) {
        onAccountCreated(create.instanceId, create.displayName);
        onClose();
      } else {
        setInstanceId(create.instanceId);
      }
    }
    setPending(false);
  };

  const { body, footer } = model;
  return (
    <Dialog
      open={model.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader title={model.title} description={model.description} />
        <WizardPanel>
          {body.kind === "setup" && instanceId && provider ? (
            renderSetup(instanceId, provider)
          ) : body.kind === "preparing" ? (
            <SettingsRow title={body.title} description={body.description} />
          ) : body.kind === "form" ? (
            <form
              id={body.formId}
              onSubmit={(event) => {
                event.preventDefault();
                void createAccount();
              }}
            >
              <SettingsRow
                title={body.title}
                description={body.description}
                control={
                  <Input
                    aria-label={body.inputLabel}
                    value={body.value}
                    disabled={body.disabled}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={body.placeholder}
                  />
                }
              />
            </form>
          ) : null}
        </WizardPanel>
        <WizardFooter>
          {footer.kind === "finish-later" ? (
            <Button variant="outline" onClick={onClose}>
              {footer.finishLater.label}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={footer.cancel.disabled} onClick={onClose}>
                {footer.cancel.label}
              </Button>
              <Button
                type="submit"
                form={body.kind === "form" ? body.formId : undefined}
                disabled={footer.submit.disabled}
              >
                {footer.submit.label}
              </Button>
            </>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
