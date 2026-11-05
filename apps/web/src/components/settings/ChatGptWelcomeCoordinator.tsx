import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { environmentPresentations } from "../../state/presentation";
import { OpenAI } from "../Icons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { ChatGptUsageButton } from "./ChatGptUsageButton";
import {
  buildChatGptWelcomeModel,
  CHATGPT_WELCOME_STORAGE_KEY,
  parseAcknowledgedChatGptProfiles,
  resolveChatGptWelcomeDismiss,
} from "./ChatGptWelcomeCoordinator.logic";

function readAcknowledgedProfiles(): readonly string[] {
  try {
    return parseAcknowledgedChatGptProfiles(localStorage.getItem(CHATGPT_WELCOME_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Read the verified environment snapshot, never the browser callback acknowledgment. */
export function ChatGptWelcomeCoordinator() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const [acknowledged, setAcknowledged] = useState(readAcknowledgedProfiles);
  const model = buildChatGptWelcomeModel({
    environments: [...presentations].map(([environmentId, presentation]) => ({
      environmentId,
      connected: presentation.connection.phase === "connected",
      environmentLabel: presentation.entry.target.label,
      providers: presentation.serverConfig?.providers ?? [],
    })),
    acknowledged,
  });
  const dismiss = () => {
    const decision = resolveChatGptWelcomeDismiss({ next: model.next, acknowledged });
    if (decision.kind === "none") return;
    setAcknowledged(decision.acknowledged);
    try {
      localStorage.setItem(CHATGPT_WELCOME_STORAGE_KEY, decision.stored);
    } catch {
      /* Session dismissal still works. */
    }
  };
  return (
    <Dialog
      open={model.open}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <OpenAI className="mb-2 size-8" aria-hidden="true" />
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
          <p className="text-xs text-muted-foreground">{model.detail}</p>
        </DialogHeader>
        <DialogFooter>
          <ChatGptUsageButton />
          <Button onClick={dismiss}>{model.continueLabel}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
