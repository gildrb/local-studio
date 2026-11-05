import type {
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  type ComposerDraftModelState,
  type ComposerThreadTarget,
  deriveEffectiveComposerModelState,
  DraftId,
  type EffectiveComposerModelState,
  EMPTY_COMPOSER_DRAFT_MODEL_STATE,
  getComposerDraftState,
  useComposerDraftStore,
} from "./composerDraftStore";

function useComposerDraftModelState(threadRef: ComposerThreadTarget): ComposerDraftModelState {
  return useComposerDraftStore(
    useShallow((state) => {
      const draft = getComposerDraftState(state, threadRef);
      return draft
        ? {
            activeProvider: draft.activeProvider,
            modelSelectionByProvider: draft.modelSelectionByProvider,
          }
        : EMPTY_COMPOSER_DRAFT_MODEL_STATE;
    }),
  );
}

export function useEffectiveComposerModelState(input: {
  threadRef?: ComposerThreadTarget;
  draftId?: DraftId;
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ProviderDriverKind;
  /**
   * When supplied, the draft's saved selection for this instance takes
   * precedence over the driver-kind bucket — so a custom `codex_personal`
   * instance reads its own model, not the default Codex's.
   */
  selectedInstanceId?: ProviderInstanceId | null | undefined;
  threadModelSelection: ModelSelection | null | undefined;
  projectModelSelection: ModelSelection | null | undefined;
  settings: UnifiedSettings;
}): EffectiveComposerModelState {
  const draft = useComposerDraftModelState(input.threadRef ?? input.draftId ?? DraftId.make(""));

  return useMemo(
    () =>
      deriveEffectiveComposerModelState({
        draft,
        providers: input.providers,
        selectedProvider: input.selectedProvider,
        selectedInstanceId: input.selectedInstanceId,
        threadModelSelection: input.threadModelSelection,
        projectModelSelection: input.projectModelSelection,
        settings: input.settings,
      }),
    [
      draft,
      input.providers,
      input.settings,
      input.projectModelSelection,
      input.selectedInstanceId,
      input.selectedProvider,
      input.threadModelSelection,
    ],
  );
}
