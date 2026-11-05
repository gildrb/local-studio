import { dynamicIconImports, iconNames, type IconName } from "lucide-react/dynamic";

export const PROJECT_ICON_CATALOG: ReadonlyArray<IconName> = iconNames;

const CANONICAL_ICON_PATTERN = /icons\/([a-z0-9-]+)\.js/;

let canonicalByName: ReadonlyMap<string, string> | null = null;

export function canonicalProjectIconName(name: string): string {
  canonicalByName ??= new Map(
    Object.entries(dynamicIconImports).flatMap(([candidate, load]): [string, string][] => {
      const canonical = CANONICAL_ICON_PATTERN.exec(load.toString())?.[1];
      return canonical ? [[candidate, canonical]] : [];
    }),
  );
  return canonicalByName.get(name) ?? name;
}
