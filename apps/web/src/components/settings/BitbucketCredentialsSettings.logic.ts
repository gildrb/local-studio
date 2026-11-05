import type { BitbucketSettings, EnvironmentId } from "@t3tools/contracts";

export type BitbucketCredentialMethod = "access-token" | "api-token";

export type BitbucketCredentialMethodOption = {
  readonly value: BitbucketCredentialMethod;
  readonly label: string;
  readonly description: string;
  readonly link: string;
  readonly linkLabel: string;
};

export type BitbucketCredentialsDraft = {
  readonly methodChoice: BitbucketCredentialMethod | null;
  readonly accessToken: string;
  readonly emailDraft: string | null;
  readonly apiToken: string;
};

export type BitbucketCredentialField = "access-token" | "email" | "api-token";

export type BitbucketCredentialFieldModel = {
  readonly field: BitbucketCredentialField;
  readonly id: string;
  readonly label: string;
  readonly inputType: "password" | "email";
  readonly placeholder: string;
  readonly value: string;
};

export type BitbucketCredentialsModelInput = {
  readonly environmentId: EnvironmentId;
  readonly saved: BitbucketSettings;
  readonly draft: BitbucketCredentialsDraft;
  readonly saving: boolean;
};

export type BitbucketCredentialsModel = {
  readonly methodGroupAriaLabel: string;
  readonly methodOptions: ReadonlyArray<BitbucketCredentialMethodOption>;
  readonly method: BitbucketCredentialMethod;
  readonly methodIsSaved: boolean;
  readonly savedMethod: BitbucketCredentialMethod | null;
  readonly description: string;
  readonly link: string;
  readonly linkLabel: string;
  readonly fields: ReadonlyArray<BitbucketCredentialFieldModel>;
  readonly footnote: string | null;
  readonly locked: boolean;
  readonly showRemove: boolean;
  readonly removeLabel: string;
  readonly removeDisabled: boolean;
  readonly saveLabel: string;
  readonly canSave: boolean;
  readonly saveDisabled: boolean;
};

export type BitbucketCredentialsIntent =
  | { readonly kind: "none" }
  | { readonly kind: "save"; readonly settings: BitbucketSettings };

export type BitbucketCredentialsSaveInput = {
  readonly saved: BitbucketSettings;
  readonly draft: BitbucketCredentialsDraft;
};

const METHODS: Record<BitbucketCredentialMethod, BitbucketCredentialMethodOption> = {
  "access-token": {
    value: "access-token",
    label: "Access token",
    description:
      "Scoped to one repository, project, or workspace. Create it in that item's Bitbucket settings.",
    link: "https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/",
    linkLabel: "Learn more",
  },
  "api-token": {
    value: "api-token",
    label: "API token",
    description:
      "Uses your Atlassian account, so it reaches every repository you can. Give it read and write access to repositories and pull requests, and read:user:bitbucket.",
    link: "https://id.atlassian.com/manage-profile/security/api-tokens",
    linkLabel: "Create an API token",
  },
};

const EMPTY_BITBUCKET_SETTINGS: BitbucketSettings = { accessToken: "", email: "", apiToken: "" };

export const EMPTY_BITBUCKET_CREDENTIALS_DRAFT: BitbucketCredentialsDraft = {
  methodChoice: null,
  accessToken: "",
  emailDraft: null,
  apiToken: "",
};

function savedMethod(saved: BitbucketSettings): BitbucketCredentialMethod | null {
  if (saved.accessToken.length > 0) return "access-token";
  if (saved.email.length > 0 && saved.apiToken.length > 0) return "api-token";
  return null;
}

type BitbucketCredentialsState = {
  readonly current: BitbucketCredentialMethod | null;
  readonly method: BitbucketCredentialMethod;
  readonly methodIsSaved: boolean;
  readonly patch: BitbucketSettings | null;
  readonly canSave: boolean;
};

function resolveCredentialsState(
  saved: BitbucketSettings,
  draft: BitbucketCredentialsDraft,
): BitbucketCredentialsState {
  const current = savedMethod(saved);
  const method = draft.methodChoice ?? current ?? "access-token";
  const methodIsSaved = current === method;
  const email = (draft.emailDraft ?? saved.email).trim();
  const newAccessToken = draft.accessToken.trim();
  const newApiToken = draft.apiToken.trim();
  const patch: BitbucketSettings | null =
    method === "access-token"
      ? newAccessToken
        ? { accessToken: newAccessToken, email: "", apiToken: "" }
        : null
      : email && (newApiToken || saved.apiToken)
        ? { accessToken: "", email, apiToken: newApiToken || saved.apiToken }
        : null;
  const canSave =
    patch !== null &&
    (method === "access-token" || !methodIsSaved || newApiToken !== "" || email !== saved.email);
  return { current, method, methodIsSaved, patch, canSave };
}

export function buildBitbucketCredentialsModel(
  input: BitbucketCredentialsModelInput,
): BitbucketCredentialsModel {
  const { environmentId, saved, draft, saving } = input;
  const { current, method, methodIsSaved, canSave } = resolveCredentialsState(saved, draft);
  const info = METHODS[method];
  const tokenPlaceholder = methodIsSaved
    ? "Stored secret, enter a new value to replace"
    : "Not set";
  const fields: BitbucketCredentialFieldModel[] =
    method === "access-token"
      ? [
          {
            field: "access-token",
            id: `bitbucket-access-token-${environmentId}`,
            label: "Access token",
            inputType: "password",
            placeholder: tokenPlaceholder,
            value: draft.accessToken,
          },
        ]
      : [
          {
            field: "email",
            id: `bitbucket-email-${environmentId}`,
            label: "Atlassian account email",
            inputType: "email",
            placeholder: "you@example.com",
            value: draft.emailDraft ?? saved.email,
          },
          {
            field: "api-token",
            id: `bitbucket-api-token-${environmentId}`,
            label: "API token",
            inputType: "password",
            placeholder: tokenPlaceholder,
            value: draft.apiToken,
          },
        ];
  return {
    methodGroupAriaLabel: "Bitbucket sign-in method",
    methodOptions: [METHODS["access-token"], METHODS["api-token"]],
    method,
    methodIsSaved,
    savedMethod: current,
    description: info.description,
    link: info.link,
    linkLabel: info.linkLabel,
    fields,
    footnote:
      current === null
        ? "Without a saved token, the server falls back to its T3CODE_BITBUCKET_* environment variables."
        : methodIsSaved
          ? null
          : `Saving replaces your ${METHODS[current].label.toLowerCase()}.`,
    locked: saving,
    showRemove: current !== null,
    removeLabel: "Remove",
    removeDisabled: saving,
    saveLabel: "Save",
    canSave,
    saveDisabled: !canSave || saving,
  };
}

export function resolveBitbucketCredentialMethodChange(
  values: ReadonlyArray<unknown>,
): BitbucketCredentialMethod | null {
  const value = values[0];
  return value === "access-token" || value === "api-token" ? value : null;
}

export function resolveBitbucketCredentialsDraftChange(
  draft: BitbucketCredentialsDraft,
  field: BitbucketCredentialField,
  value: string,
): BitbucketCredentialsDraft {
  if (field === "access-token") return { ...draft, accessToken: value };
  if (field === "email") return { ...draft, emailDraft: value };
  return { ...draft, apiToken: value };
}

export function resolveBitbucketCredentialsSave(
  input: BitbucketCredentialsSaveInput,
): BitbucketCredentialsIntent {
  const { patch, canSave } = resolveCredentialsState(input.saved, input.draft);
  return canSave && patch ? { kind: "save", settings: patch } : { kind: "none" };
}

export function resolveBitbucketCredentialsRemove(): BitbucketCredentialsIntent {
  return { kind: "save", settings: EMPTY_BITBUCKET_SETTINGS };
}

export function resolveBitbucketCredentialsSaved(
  draft: BitbucketCredentialsDraft,
): BitbucketCredentialsDraft {
  return { ...draft, accessToken: "", emailDraft: null, apiToken: "" };
}
