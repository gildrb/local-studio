export function getThreadErrorBannerKey(threadKey: string, error: string | null): string | null {
  return error === null ? null : `${threadKey}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes between threads). Mirrors the branch-mismatch banner: a dismissal
// is remembered per thread key plus message, so navigating away to a thread
// with no error cannot resurrect the banner, while a different error message
// on the same thread still appears.
const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

export function resolveThreadError(input: {
  readonly isServerThread: boolean;
  readonly localServerError: string | null;
  readonly sessionLastError: string | null | undefined;
  readonly localDraftError: string | null;
}): string | null {
  return input.isServerThread
    ? (input.localServerError ?? input.sessionLastError ?? null)
    : input.localDraftError;
}

export function resolveVisibleThreadError(
  threadKey: string,
  threadError: string | null,
): string | null {
  return shouldShowThreadErrorBanner(
    threadKey,
    threadError,
    isThreadErrorBannerDismissedForSession(getThreadErrorBannerKey(threadKey, threadError)),
  )
    ? threadError
    : null;
}
