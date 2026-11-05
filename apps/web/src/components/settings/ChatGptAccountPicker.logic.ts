import type { ProviderAuthMethod } from "@t3tools/contracts";

export const CHATGPT_CONNECTION_LABEL = "Continue with ChatGPT";
export const CHATGPT_CHANGE_ACCOUNT_METHOD_ID = "chatgpt-change-account";
export const CHATGPT_PROFILE_PREFIX = "chatgpt-profile:";

export type ChatGptAccountPickerModelInput = {
  readonly methods: readonly ProviderAuthMethod[];
  readonly selection: string | null;
};

export type ChatGptAccountOption = {
  readonly kind: "profile" | "different-account";
  readonly value: string;
  readonly label: string;
};

export type ChatGptAccountPickerModel = {
  readonly title: string;
  readonly description: string;
  readonly groupLabel: string;
  readonly selectedMethodId: string;
  readonly options: readonly ChatGptAccountOption[];
  readonly confirmLabel: string;
};

export function buildChatGptAccountPickerModel(
  input: ChatGptAccountPickerModelInput,
): ChatGptAccountPickerModel {
  const profiles = input.methods.filter((method) => method.id.startsWith(CHATGPT_PROFILE_PREFIX));
  const selectedMethodId =
    input.selection === CHATGPT_CHANGE_ACCOUNT_METHOD_ID
      ? input.selection
      : (profiles.find((profile) => profile.id === input.selection)?.id ??
        profiles[0]?.id ??
        CHATGPT_CHANGE_ACCOUNT_METHOD_ID);
  return {
    title: "Reconnect ChatGPT",
    description: "On OpenAI, sign in with the account you choose here.",
    groupLabel: "ChatGPT account to connect",
    selectedMethodId,
    options: [
      ...profiles.map((profile): ChatGptAccountOption => ({
        kind: "profile",
        value: profile.id,
        label: profile.name,
      })),
      {
        kind: "different-account",
        value: CHATGPT_CHANGE_ACCOUNT_METHOD_ID,
        label: "Use a different account",
      },
    ],
    confirmLabel: CHATGPT_CONNECTION_LABEL,
  };
}
