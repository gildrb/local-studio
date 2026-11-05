import * as React from "react";

import {
  createThreadJumpHintVisibilityController,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
  type ThreadJumpHintVisibilityController,
} from "./Sidebar.logic";

// A small buffer keeps the next few rows warm without leasing every row that
// content-visibility leaves mounted below the scroll viewport.
const SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX = 160;

export function useSidebarRowSubscriptionLease(isActive: boolean): {
  readonly leaseLiveStatus: boolean;
  readonly rowRef: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
} {
  const [row, setRow] = React.useState<HTMLElement | null>(null);
  const [isNearViewport, setIsNearViewport] = React.useState(isActive);

  React.useEffect(() => {
    if (isActive) {
      setIsNearViewport(true);
      return;
    }
    if (row === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const scrollRoot = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(entry?.isIntersecting === true),
      {
        root: scrollRoot,
        rootMargin: `${SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX}px 0px`,
      },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [isActive, row]);

  return {
    leaseLiveStatus: isActive || isNearViewport,
    rowRef: setRow,
  };
}

// A row keeps the last live value it rendered so a released lease never
// blanks its badge. The value is bound to `key`, so a different worktree or
// linked pull request cannot reuse the previous one.
export function useRetainedValue<T>(key: string | null, value: T | null): T | null {
  const retained = React.useRef<{ readonly key: string; readonly value: T } | null>(null);
  if (key !== null && value !== null) {
    retained.current = { key, value };
  }
  if (value !== null) return value;
  return key !== null && retained.current?.key === key ? retained.current.value : null;
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}
