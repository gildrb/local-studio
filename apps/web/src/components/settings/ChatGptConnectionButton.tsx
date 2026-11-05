import type { ComponentProps } from "react";
import { OpenAI } from "../Icons";
import { Button } from "../ui/button";
import { CHATGPT_CONNECTION_LABEL } from "./ChatGptAccountPicker.logic";

export function ChatGptConnectionButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button {...props}>
      <OpenAI className="size-4 shrink-0" aria-hidden="true" />
      {children ?? CHATGPT_CONNECTION_LABEL}
    </Button>
  );
}
