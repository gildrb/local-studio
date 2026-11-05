import { useState } from "react";
import type { ProviderAuthMethod } from "@t3tools/contracts";
import { RadioGroup, Radio } from "../ui/radio-group";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { ChatGptConnectionButton } from "./ChatGptConnectionButton";
import { buildChatGptAccountPickerModel } from "./ChatGptAccountPicker.logic";

export function ChatGptAccountPicker({
  open,
  methods,
  onClose,
  onSelect,
}: {
  open: boolean;
  methods: readonly ProviderAuthMethod[];
  onClose: () => void;
  onSelect: (methodId: string) => void;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const model = buildChatGptAccountPickerModel({ methods, selection });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">
          <RadioGroup
            aria-label={model.groupLabel}
            value={model.selectedMethodId}
            onValueChange={(value) => setSelection(value)}
          >
            {model.options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm"
              >
                <Radio value={option.value} />
                <span
                  className={
                    option.kind === "profile" ? "min-w-0 break-all font-medium" : "font-medium"
                  }
                >
                  {option.label}
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <DialogFooter>
          <ChatGptConnectionButton onClick={() => onSelect(model.selectedMethodId)}>
            {model.confirmLabel}
          </ChatGptConnectionButton>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
