import type { ComponentProps } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { CHATGPT_USAGE_BUTTON } from "./ChatGptWelcomeCoordinator.logic";

export function ChatGptUsageButton(props: Omit<ComponentProps<typeof Button>, "onClick">) {
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      {...props}
      onClick={() => void ensureLocalApi().shell.openExternal(CHATGPT_USAGE_BUTTON.url)}
    >
      {CHATGPT_USAGE_BUTTON.label}
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
