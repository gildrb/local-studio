import { Fragment } from "react";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { buildSettingsBreadcrumbModel } from "./SettingsBreadcrumb.logic";

/**
 * `Settings / Section`. The scope a change applies to lives at the top of the
 * page content, see `SettingsScopeSentence`.
 */
export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const model = buildSettingsBreadcrumbModel(pathname);

  return (
    <WorkspaceBreadcrumb ariaLabel={model.ariaLabel}>
      {model.items.map((item) =>
        item.current ? (
          <WorkspaceBreadcrumbItem key={item.label} current className="truncate">
            {item.label}
          </WorkspaceBreadcrumbItem>
        ) : (
          <Fragment key={item.label}>
            <WorkspaceBreadcrumbItem>{item.label}</WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
          </Fragment>
        ),
      )}
    </WorkspaceBreadcrumb>
  );
}
