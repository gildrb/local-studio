import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": "Diagnostics",
  "/settings/open-source-licenses": "Open source licenses",
};

export type SettingsBreadcrumbItem = {
  readonly label: string;
  readonly current: boolean;
};

export type SettingsBreadcrumbModel = {
  readonly ariaLabel: string;
  readonly sectionLabel: string | null;
  readonly items: ReadonlyArray<SettingsBreadcrumbItem>;
};

export function settingsBreadcrumbLabel(pathname: string): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_BREADCRUMB_LABELS[normalizedPathname] ?? null;
}

export function buildSettingsBreadcrumbModel(pathname: string): SettingsBreadcrumbModel {
  const sectionLabel = settingsBreadcrumbLabel(pathname);
  return {
    ariaLabel: "Settings breadcrumb",
    sectionLabel,
    items:
      sectionLabel === null
        ? [{ label: "Settings", current: true }]
        : [
            { label: "Settings", current: false },
            { label: sectionLabel, current: true },
          ],
  };
}
