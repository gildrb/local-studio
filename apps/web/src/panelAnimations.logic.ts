export const RESPONSIVE_BREAKPOINT_FADE_MAX_MS = 100;

export function responsiveBreakpointFadeDurationMs(panelAnimationDurationMs: number): number {
  return Math.min(RESPONSIVE_BREAKPOINT_FADE_MAX_MS, panelAnimationDurationMs);
}
