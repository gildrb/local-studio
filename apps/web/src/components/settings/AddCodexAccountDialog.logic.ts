import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";

export type AddCodexAccountModelInput = {
  readonly name: string;
  readonly instanceId: string | null;
  readonly pending: boolean;
  readonly providerHasSetup: boolean;
  readonly connected: boolean;
};

export type AddCodexAccountButton = {
  readonly label: string;
  readonly disabled: boolean;
};

export type AddCodexAccountModel = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly body:
    | { readonly kind: "setup" }
    | { readonly kind: "preparing"; readonly title: string; readonly description: string }
    | {
        readonly kind: "form";
        readonly formId: string;
        readonly title: string;
        readonly description: string;
        readonly inputLabel: string;
        readonly placeholder: string;
        readonly value: string;
        readonly disabled: boolean;
      };
  readonly footer:
    | { readonly kind: "finish-later"; readonly finishLater: AddCodexAccountButton }
    | {
        readonly kind: "create";
        readonly cancel: AddCodexAccountButton;
        readonly submit: AddCodexAccountButton;
      };
};

const ADD_CODEX_ACCOUNT_FORM_ID = "add-codex-account";

export function resolveAddCodexAccountDisplayName(name: string): string {
  return `ChatGPT - ${name.trim()}`;
}

export function buildAddCodexAccountModel(input: AddCodexAccountModelInput): AddCodexAccountModel {
  const displayName = resolveAddCodexAccountDisplayName(input.name);
  return {
    open: !input.connected,
    title: input.instanceId ? displayName : "Add ChatGPT account",
    description:
      "Each account has its own Codex instance and sign-in. Choose the other account on the sign-in page.",
    body: input.instanceId
      ? input.providerHasSetup
        ? { kind: "setup" }
        : { kind: "preparing", title: "Codex runtime", description: "Preparing managed setup." }
      : {
          kind: "form",
          formId: ADD_CODEX_ACCOUNT_FORM_ID,
          title: "Account name",
          description: "Shown in the provider list and model picker.",
          inputLabel: "Account name",
          placeholder: "e.g. Personal or Work",
          value: input.name,
          disabled: input.pending,
        },
    footer: input.instanceId
      ? { kind: "finish-later", finishLater: { label: "Finish later", disabled: false } }
      : {
          kind: "create",
          cancel: { label: "Cancel", disabled: input.pending },
          submit: {
            label: input.pending ? "Adding account…" : "Continue",
            disabled: input.pending || !input.name.trim(),
          },
        },
  };
}

export type AddCodexAccountCreateInput = {
  readonly name: string;
  readonly pending: boolean;
  readonly instanceSuffix: string;
  readonly providerInstances:
    | Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>
    | undefined;
};

export type AddCodexAccountCreate =
  | { readonly kind: "none" }
  | {
      readonly kind: "create";
      readonly instanceId: ProviderInstanceId;
      readonly displayName: string;
      readonly providerInstances: Record<ProviderInstanceId, ProviderInstanceConfig>;
    };

export function resolveAddCodexAccountCreate(
  input: AddCodexAccountCreateInput,
): AddCodexAccountCreate {
  if (input.pending || !input.name.trim()) return { kind: "none" };
  const instanceId = ProviderInstanceId.make(`codex_${input.instanceSuffix}`);
  const displayName = resolveAddCodexAccountDisplayName(input.name);
  return {
    kind: "create",
    instanceId,
    displayName,
    providerInstances: {
      ...input.providerInstances,
      [instanceId]: {
        driver: ProviderDriverKind.make("codex"),
        displayName,
        enabled: true,
        config: { enabled: true, setupMode: "managed" },
      },
    },
  };
}
