import {
  resolvePierreIconColor,
  resolvePierreIconForEntry,
} from "@t3tools/web/src/pierre-icons.ts";

export type PierreIconPaint = {
  readonly asset: string;
  readonly color: string | null;
};

export type PierreIconView = {
  readonly dark: PierreIconPaint;
  readonly light: PierreIconPaint;
};

type IconColoring = "fixed" | "themed";

const MULTICOLOR_ICONS: Readonly<Record<string, IconColoring | undefined>> = {
  "t3-file-icon-video": "fixed",
  "file-tree-builtin-nextjs": "themed",
  "t3-file-icon-pnpm": "themed",
};

const ICON_ROOT = "icons/pierre";

function paint(name: string, token: string | undefined, theme: "dark" | "light"): PierreIconPaint {
  switch (MULTICOLOR_ICONS[name]) {
    case "fixed":
      return { asset: `${ICON_ROOT}/${name}.svg`, color: null };
    case "themed":
      return { asset: `${ICON_ROOT}/${name}-${theme}.svg`, color: null };
    case undefined:
      return {
        asset: `${ICON_ROOT}/${name}.svg`,
        color: resolvePierreIconColor(token, theme) ?? null,
      };
  }
}

export function pierreIconView(name: string, token: string | undefined): PierreIconView {
  return { dark: paint(name, token, "dark"), light: paint(name, token, "light") };
}

const TREE_MUTED_ICON_COLOR = "#84848a";
const TREE_UNSTYLED_TOKENS: Readonly<Record<string, true | undefined>> = {
  nextjs: true,
  stylelint: true,
};

/**
 * The icon a Pierre file tree row draws: the tree colors tokens through its own
 * stylesheet, and icons with no styled token keep the muted row icon color.
 */
export function pierreTreeIconView(name: string, token: string | undefined): PierreIconView {
  const view = pierreIconView(name, token);
  if (token !== undefined && TREE_UNSTYLED_TOKENS[token] !== true) return view;
  const muted = (paint: PierreIconPaint): PierreIconPaint =>
    paint.color === null ? paint : { ...paint, color: TREE_MUTED_ICON_COLOR };
  return { dark: muted(view.dark), light: muted(view.light) };
}

export function resolvePierreFileIcon(path: string): PierreIconView {
  const icon = resolvePierreIconForEntry(path, "file");
  return icon === null
    ? pierreIconView("file-tree-builtin-default", "default")
    : pierreIconView(icon.name, icon.token);
}
