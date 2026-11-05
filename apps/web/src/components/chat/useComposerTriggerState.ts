import { useCallback, useRef, useState } from "react";

import type { ComposerTrigger } from "../../composer-logic";
import { resolveComposerTriggerAfterDismissal } from "./composerTriggers.logic";

/** Keep a dismissed suggestion closed until the caret leaves its token. */
export function useComposerTriggerState(initialTrigger: () => ComposerTrigger | null) {
  const [trigger, setActiveTrigger] = useState(initialTrigger);
  const dismissedTriggerRef = useRef<ComposerTrigger | null>(null);

  const resolveTrigger = useCallback(
    (candidate: ComposerTrigger | null) =>
      resolveComposerTriggerAfterDismissal(candidate, dismissedTriggerRef.current),
    [],
  );

  const setTrigger = useCallback(
    (candidate: ComposerTrigger | null) => {
      const activeTrigger = resolveTrigger(candidate);
      if (candidate === null || activeTrigger !== null) {
        dismissedTriggerRef.current = null;
      }
      setActiveTrigger(activeTrigger);
    },
    [resolveTrigger],
  );

  const dismissTrigger = useCallback((candidate: ComposerTrigger | null) => {
    dismissedTriggerRef.current = candidate;
    setActiveTrigger(null);
  }, []);

  const resetTrigger = useCallback((candidate: ComposerTrigger | null) => {
    dismissedTriggerRef.current = null;
    setActiveTrigger(candidate);
  }, []);

  return { trigger, setTrigger, resolveTrigger, dismissTrigger, resetTrigger };
}
