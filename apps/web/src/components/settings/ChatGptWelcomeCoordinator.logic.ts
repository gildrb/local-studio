import type { ServerProvider } from "@t3tools/contracts";
import { CHATGPT_USAGE_URL, usesChatGptSharing } from "@t3tools/shared/usageLimits";

export const CHATGPT_WELCOME_STORAGE_KEY = "t3:chatgpt-sharing-welcome:v1";

export type ChatGptUsageButtonModel = {
  readonly label: string;
  readonly url: string;
  readonly iconKey: "external-link";
};

export const CHATGPT_USAGE_BUTTON: ChatGptUsageButtonModel = {
  label: "Manage usage",
  url: CHATGPT_USAGE_URL,
  iconKey: "external-link",
};

export function parseAcknowledgedChatGptProfiles(stored: string | null): string[] {
  try {
    const value: unknown = JSON.parse(stored ?? "[]");
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

export type ChatGptWelcomeEnvironment = {
  readonly environmentId: string;
  readonly connected: boolean;
  readonly environmentLabel: string;
  readonly providers: readonly ServerProvider[];
};

export type ChatGptWelcomeProfile = {
  readonly key: string;
  readonly environmentLabel: string;
  readonly providerName: string;
};

export type ChatGptWelcomeModelInput = {
  readonly environments: readonly ChatGptWelcomeEnvironment[];
  readonly acknowledged: readonly string[];
};

export type ChatGptWelcomeModel = {
  readonly open: boolean;
  readonly next: ChatGptWelcomeProfile | null;
  readonly iconKey: "openai";
  readonly title: string;
  readonly description: string;
  readonly detail: string;
  readonly usage: ChatGptUsageButtonModel;
  readonly continueLabel: string;
};

export function buildChatGptWelcomeModel(input: ChatGptWelcomeModelInput): ChatGptWelcomeModel {
  const profiles = input.environments.flatMap((environment) =>
    !environment.connected
      ? []
      : environment.providers.filter(usesChatGptSharing).map((provider) => ({
          key: JSON.stringify([
            environment.environmentId,
            provider.instanceId,
            provider.auth.profileId ?? provider.auth.email ?? "default",
          ]),
          environmentLabel: environment.environmentLabel,
          providerName: provider.displayName ?? "Codex",
        })),
  );
  const next = profiles.find((profile) => !input.acknowledged.includes(profile.key)) ?? null;
  return {
    open: next !== null,
    next,
    iconKey: "openai",
    title: "Your ChatGPT plan is connected",
    description:
      "Eligible usage in T3 Code uses your ChatGPT plan. Manage your shared usage and any credit settings in ChatGPT.",
    detail: `${next?.providerName ?? ""} on ${next?.environmentLabel ?? ""}`,
    usage: CHATGPT_USAGE_BUTTON,
    continueLabel: "Continue",
  };
}

export type ChatGptWelcomeDismiss =
  | { readonly kind: "none" }
  | {
      readonly kind: "acknowledge";
      readonly acknowledged: readonly string[];
      readonly stored: string;
    };

export function resolveChatGptWelcomeDismiss(input: {
  readonly next: ChatGptWelcomeProfile | null;
  readonly acknowledged: readonly string[];
}): ChatGptWelcomeDismiss {
  if (!input.next) return { kind: "none" };
  const acknowledged = [...input.acknowledged, input.next.key];
  return { kind: "acknowledge", acknowledged, stored: JSON.stringify(acknowledged) };
}
