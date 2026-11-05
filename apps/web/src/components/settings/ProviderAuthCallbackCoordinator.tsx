import { useEffect, useRef, useState } from "react";
import { pendingProviderAuthDelivery, clearProviderAuthDelivery } from "../../providerAuthDelivery";
import { serverEnvironment } from "../../state/server";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import {
  isProviderAuthDeliveryConnected,
  resolveProviderAuthCallbackFeedback,
  resolveProviderAuthCompletion,
  type ProviderAuthCallbackOutcome,
} from "./ProviderAuthCallbackCoordinator.logic";

/** Hosted web receives only the one-time code; the selected environment verifies and stores tokens. */
export function ProviderAuthCallbackCoordinator() {
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, {
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const [delivery, setDelivery] = useState(pendingProviderAuthDelivery);
  const started = useRef(false);
  const connected = isProviderAuthDeliveryConnected(
    delivery,
    environments.map((environment) => ({
      environmentId: environment.environmentId,
      connected: environment.connection.phase === "connected",
    })),
  );
  useEffect(() => {
    const completion = resolveProviderAuthCompletion({
      delivery,
      started: started.current,
      connected,
    });
    if (!completion) return;
    started.current = true;
    const report = (outcome: ProviderAuthCallbackOutcome) => {
      const feedback = resolveProviderAuthCallbackFeedback(outcome);
      if (feedback.kind === "error-toast") {
        toastManager.add({
          type: "error",
          title: feedback.title,
          description: feedback.description,
        });
      }
    };
    void completeAuth(completion)
      .then((result) => report(result._tag === "Failure" ? "failure" : "success"))
      .catch(() => report("error"))
      .finally(() => {
        setDelivery(undefined);
        clearProviderAuthDelivery();
      });
  }, [completeAuth, connected, delivery]);
  return null;
}
