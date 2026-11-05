import type { ScopedProjectRef, ScopedThreadRef, VcsStatusResult } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import type { ComposerSendToast } from "@t3tools/web/src/components/chat/composerSend.logic.ts";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";
import type { UiState } from "@t3tools/web/src/uiState.logic.ts";
import type { DraftId, DraftThreadState } from "@t3tools/web/src/composerDraftStore.ts";
import type { NewThreadOptions, NewThreadResult } from "@t3tools/web/src/hooks/newThread.logic.ts";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes.ts";

import type { CoreAttachmentUploads } from "./attachmentUploads.ts";
import type { ComposerModelInput } from "./composerView.ts";
import type { AppPage, AppPageKind } from "./page.ts";
import type { Send } from "./protocol.ts";
import type { NativeDesktop } from "./nativeDesktop.ts";
import type { CoreState } from "./state.ts";

export type ThreadInput = ComposerModelInput & {
  readonly route: ScopedThreadRef;
  readonly draftId: DraftId | null;
  readonly draftThread: DraftThreadState | null;
  readonly isServerThread: boolean;
};

export type GitStatusSnapshot = {
  readonly gitCwd: string;
  readonly status: VcsStatusResult | null;
  readonly error: string | null;
};

export type FeatureContext = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: CoreState;
  readonly attachmentUploads: CoreAttachmentUploads;
  readonly platform: string;
  readonly stageLabel: string;
  readonly t3Home: string;
  readonly desktop: NativeDesktop;
  readonly storage: Storage;
  readonly routeAtom: Atom.Atom<ScopedThreadRef | null>;
  readonly routeTargetAtom: Atom.Atom<ThreadRouteTarget | null>;
  readonly threadInputAtom: Atom.Atom<ThreadInput | null>;
  readonly gitStatusAtom: Atom.Atom<GitStatusSnapshot | null>;
  readonly clientSettingsAtom: Atom.Atom<ClientSettings>;
  readonly updateClientSettings: (
    update: (current: ClientSettings) => ClientSettings,
  ) => Promise<void>;
  readonly addToast: (toast: ComposerSendToast) => string;
  readonly closeToast: (id: string) => void;
  readonly setThreadError: (threadId: string, error: string | null) => void;
  readonly send: Send;
  readonly pageAtom: Atom.Writable<AppPage>;
  readonly uiStateAtom: Atom.Atom<UiState>;
  readonly navigateToThread: (ref: ScopedThreadRef) => void;
  readonly navigateHome: () => void;
  readonly updateUiState: (update: (current: UiState) => UiState) => void;
  readonly navigateToDraft: (draftId: DraftId) => void;
  readonly openNewThread: (
    projectRef: ScopedProjectRef,
    options?: NewThreadOptions,
  ) => Promise<NewThreadResult | null>;
  readonly draftHeroStateAtom: Atom.Atom<boolean>;
  readonly navigate: (page: AppPage) => void;
  readonly writePrompt: (route: ScopedThreadRef, prompt: string) => void;
};

export type FeatureAction = (params: unknown) => Promise<unknown>;

export type CoreFeature = {
  readonly views: Readonly<Record<string, Atom.Atom<unknown>>>;
  readonly actions: Readonly<Record<string, FeatureAction>>;
  readonly pages?: ReadonlyArray<AppPageKind>;
};
