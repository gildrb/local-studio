import { mixThemePreviewBase, THEME_PREVIEW_RENDER_SPECS } from "@t3tools/shared/themePreview";
import { themeColorToHex, type ThemeAppearance } from "@t3tools/web/src/themePalette.ts";

export type ThemeOrbColors = {
  readonly canvas: string;
  readonly accent: string;
  readonly messageAction: string;
};

const ORB_SIZE = 52;

function farthestCorner(x: number, y: number): number {
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(ORB_SIZE - x, y),
    Math.hypot(x, ORB_SIZE - y),
    Math.hypot(ORB_SIZE - x, ORB_SIZE - y),
  );
}

function round(value: number): string {
  return Number(value.toFixed(3)).toString();
}

const cache = new Map<string, string>();

export function themeOrbSvg(colors: ThemeOrbColors, mode: ThemeAppearance): string {
  const key = `${mode}|${colors.canvas}|${colors.accent}|${colors.messageAction}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const spec = THEME_PREVIEW_RENDER_SPECS[mode];
  const base = mixThemePreviewBase(colors, mode);
  const accent = themeColorToHex(colors.accent) ?? colors.accent;
  const action = themeColorToHex(colors.messageAction) ?? colors.messageAction;
  const accentX = spec.accent.center[0] * ORB_SIZE;
  const accentY = spec.accent.center[1] * ORB_SIZE;
  const actionX = spec.action.center[0] * ORB_SIZE;
  const actionY = spec.action.center[1] * ORB_SIZE;
  const half = ORB_SIZE / 2;
  const blur = (spec.blurAt56Px * ORB_SIZE) / 56;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ORB_SIZE}" height="${ORB_SIZE}" viewBox="0 0 ${ORB_SIZE} ${ORB_SIZE}">`,
    "<defs>",
    `<radialGradient id="accent" gradientUnits="userSpaceOnUse" cx="${round(accentX)}" cy="${round(accentY)}" r="${round(farthestCorner(accentX, accentY))}">`,
    `<stop offset="0" stop-color="${accent}"/>`,
    `<stop offset="${spec.accent.middleOffset}" stop-color="${accent}" stop-opacity="${spec.accent.middleOpacity}"/>`,
    `<stop offset="${spec.accent.endOffset}" stop-color="${accent}" stop-opacity="0"/>`,
    "</radialGradient>",
    `<radialGradient id="action" gradientUnits="userSpaceOnUse" cx="${round(actionX)}" cy="${round(actionY)}" r="${round(farthestCorner(actionX, actionY))}">`,
    `<stop offset="0" stop-color="${action}" stop-opacity="${spec.action.startOpacity}"/>`,
    `<stop offset="${spec.action.endOffset}" stop-color="${action}" stop-opacity="0"/>`,
    "</radialGradient>",
    `<filter id="blur" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="${round(blur)}"/></filter>`,
    `<clipPath id="clip"><circle cx="${half}" cy="${half}" r="${half}"/></clipPath>`,
    "</defs>",
    `<g clip-path="url(#clip)">`,
    `<g filter="url(#blur)" transform="translate(${half} ${half}) scale(${spec.scale}) translate(-${half} -${half})">`,
    `<rect width="${ORB_SIZE}" height="${ORB_SIZE}" fill="${base}"/>`,
    `<rect width="${ORB_SIZE}" height="${ORB_SIZE}" fill="url(#accent)"/>`,
    `<rect width="${ORB_SIZE}" height="${ORB_SIZE}" fill="url(#action)"/>`,
    "</g>",
    "</g>",
    "</svg>",
  ].join("");
  cache.set(key, svg);
  return svg;
}
