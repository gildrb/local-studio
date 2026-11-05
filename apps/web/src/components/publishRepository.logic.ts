import type {
  SourceControlCloneProtocol,
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

export type PublishProviderKind = Extract<
  SourceControlProviderKind,
  "github" | "gitlab" | "forgejo" | "bitbucket" | "azure-devops"
>;

export interface PublishProviderOption {
  readonly value: PublishProviderKind;
  readonly label: string;
  readonly description: string;
  readonly host: string;
  readonly pathPlaceholder: string;
}

const PUBLISH_PROVIDER_OPTION_BY_KIND: Readonly<
  Record<PublishProviderKind, PublishProviderOption>
> = {
  forgejo: {
    value: "forgejo",
    label: "Forgejo / Gitea",
    description: "Your signed-in server",
    host: "your server",
    pathPlaceholder: "owner/repo",
  },
  github: {
    value: "github",
    label: "GitHub",
    description: "github.com",
    host: "github.com",
    pathPlaceholder: "owner/repo",
  },
  gitlab: {
    value: "gitlab",
    label: "GitLab",
    description: "gitlab.com",
    host: "gitlab.com",
    pathPlaceholder: "group/project",
  },
  bitbucket: {
    value: "bitbucket",
    label: "Bitbucket",
    description: "bitbucket.org",
    host: "bitbucket.org",
    pathPlaceholder: "workspace/repository",
  },
  "azure-devops": {
    value: "azure-devops",
    label: "Azure DevOps",
    description: "dev.azure.com",
    host: "dev.azure.com",
    pathPlaceholder: "project/repository",
  },
};

export const PUBLISH_PROVIDER_OPTIONS: ReadonlyArray<PublishProviderOption> = [
  PUBLISH_PROVIDER_OPTION_BY_KIND.forgejo,
  PUBLISH_PROVIDER_OPTION_BY_KIND.github,
  PUBLISH_PROVIDER_OPTION_BY_KIND.gitlab,
  PUBLISH_PROVIDER_OPTION_BY_KIND.bitbucket,
  PUBLISH_PROVIDER_OPTION_BY_KIND["azure-devops"],
];

export const PUBLISH_VISIBILITY_OPTIONS: ReadonlyArray<{
  readonly value: SourceControlRepositoryVisibility;
  readonly label: string;
  readonly description: string;
  readonly icon: "lock" | "globe";
}> = [
  { value: "private", label: "Private", description: "Only invited people", icon: "lock" },
  { value: "public", label: "Public", description: "Anyone on the web", icon: "globe" },
];

export const PUBLISH_WIZARD_STEPS: ReadonlyArray<string> = ["Provider", "Repository", "Summary"];

export function isPublishProviderKind(
  provider: SourceControlProviderKind,
): provider is PublishProviderKind {
  return PUBLISH_PROVIDER_OPTIONS.some((option) => option.value === provider);
}

export interface PublishProviderReadiness {
  readonly ready: boolean;
  readonly hint: string | null;
}

export function getPublishProviderReadiness(input: {
  provider: PublishProviderKind;
  sourceControlProviders: ReadonlyArray<SourceControlProviderDiscoveryItem>;
}): PublishProviderReadiness {
  const discovered = input.sourceControlProviders.find(
    (provider) => provider.kind === input.provider,
  );
  if (!discovered) {
    return {
      ready: false,
      hint: "Provider status unavailable. Open Settings -> Source Control and rescan.",
    };
  }
  if (discovered.status !== "available") {
    return { ready: false, hint: discovered.installHint };
  }
  if (discovered.auth.status === "unauthenticated") {
    return {
      ready: false,
      hint:
        Option.getOrNull(discovered.auth.detail) ??
        `${discovered.label} is not authenticated. Open Settings -> Source Control for setup guidance.`,
    };
  }
  return { ready: true, hint: null };
}

export interface PublishRepositoryState {
  readonly readiness: Readonly<Record<PublishProviderKind, PublishProviderReadiness>>;
  readonly hasReadyProvider: boolean;
  readonly sortedOptions: ReadonlyArray<PublishProviderOption>;
  readonly provider: PublishProviderKind;
  readonly providerReadiness: PublishProviderReadiness;
  readonly providerOption: PublishProviderOption;
  readonly repository: string;
  readonly host: string;
  readonly stepSummaries: ReadonlyArray<string | null>;
  readonly canSubmit: boolean;
}

export function resolvePublishRepositoryState(input: {
  readonly sourceControlProviders: ReadonlyArray<SourceControlProviderDiscoveryItem>;
  readonly selectedProvider: PublishProviderKind | null;
  readonly repositoryOverride: string | null;
  readonly isPending: boolean;
  readonly result: SourceControlPublishRepositoryResult | null;
}): PublishRepositoryState {
  const providers = input.sourceControlProviders;
  const readinessFor = (provider: PublishProviderKind) =>
    getPublishProviderReadiness({ provider, sourceControlProviders: providers });
  const readiness: Record<PublishProviderKind, PublishProviderReadiness> = {
    github: readinessFor("github"),
    gitlab: readinessFor("gitlab"),
    forgejo: readinessFor("forgejo"),
    bitbucket: readinessFor("bitbucket"),
    "azure-devops": readinessFor("azure-devops"),
  };
  const accounts: Record<PublishProviderKind, string | null> = {
    github: null,
    gitlab: null,
    forgejo: null,
    bitbucket: null,
    "azure-devops": null,
  };
  for (const provider of providers) {
    if (isPublishProviderKind(provider.kind)) {
      accounts[provider.kind] = Option.getOrNull(provider.auth.account);
    }
  }
  const sortedOptions = PUBLISH_PROVIDER_OPTIONS.toSorted((left, right) => {
    const leftReady = readiness[left.value].ready;
    const rightReady = readiness[right.value].ready;
    if (leftReady !== rightReady) {
      return leftReady ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
  const firstReadyProvider = sortedOptions.find((option) => readiness[option.value].ready)?.value;
  const provider =
    input.selectedProvider !== null && readiness[input.selectedProvider].ready
      ? input.selectedProvider
      : (firstReadyProvider ?? input.selectedProvider ?? "github");
  const providerReadiness = readiness[provider];
  const account = accounts[provider];
  const repository = input.repositoryOverride ?? (account ? `${account}/` : "");
  const providerOption = PUBLISH_PROVIDER_OPTION_BY_KIND[provider];
  const host =
    provider === "forgejo"
      ? (Option.getOrNull(
          providers.find((candidate) => candidate.kind === "forgejo")?.auth.host ?? Option.none(),
        ) ?? providerOption.host)
      : providerOption.host;
  const repositoryParts = repository.trim().split("/");
  const owner = repositoryParts[0]?.trim() ?? "";
  const name = repositoryParts.slice(1).join("/").trim();
  return {
    readiness,
    hasReadyProvider: PUBLISH_PROVIDER_OPTIONS.some((option) => readiness[option.value].ready),
    sortedOptions,
    provider,
    providerReadiness,
    providerOption,
    repository,
    host,
    stepSummaries: [providerOption.label, input.result?.repository.nameWithOwner ?? null, null],
    canSubmit: providerReadiness.ready && !input.isPending && owner.length > 0 && name.length > 0,
  };
}

export function isPublishWizardStepDisabled(index: number, currentStep: number): boolean {
  return currentStep === 2 || index >= PUBLISH_WIZARD_STEPS.length - 1 || index > currentStep;
}

export function buildPublishRepositoryInput(input: {
  readonly provider: PublishProviderKind;
  readonly repository: string;
  readonly visibility: SourceControlRepositoryVisibility;
  readonly remoteName: string;
  readonly protocol: SourceControlCloneProtocol;
}): {
  readonly provider: PublishProviderKind;
  readonly repository: string;
  readonly visibility: SourceControlRepositoryVisibility;
  readonly remoteName: string;
  readonly protocol: SourceControlCloneProtocol;
} {
  return {
    provider: input.provider,
    repository: input.repository.trim(),
    visibility: input.visibility,
    remoteName: input.remoteName.trim() || "origin",
    protocol: input.protocol,
  };
}

export function resolvePublishResultCopy(
  result: SourceControlPublishRepositoryResult,
  providerLabel: string,
): { readonly title: string; readonly description: string } {
  return result.status === "pushed"
    ? {
        title: "Repository published",
        description: `${result.branch} is now live on ${providerLabel}.`,
      }
    : {
        title: "Repository created",
        description: `Remote "${result.remoteName}" is set up. Make a commit and push it to share your code.`,
      };
}
