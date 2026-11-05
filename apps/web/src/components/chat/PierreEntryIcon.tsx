import { FileIcon, FolderIcon } from "lucide-react";
import { memo, useInsertionEffect, useMemo } from "react";

import {
  ensurePierreIconSprite,
  resolvePierreIconColor,
  resolvePierreIconForEntry,
} from "../../pierre-icons";
import { cn } from "~/lib/utils";

export const PierreEntryIcon = memo(function PierreEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  className?: string;
}) {
  useInsertionEffect(ensurePierreIconSprite, []);
  const icon = useMemo(
    () => resolvePierreIconForEntry(props.pathValue, props.kind),
    [props.kind, props.pathValue],
  );

  if (!icon) {
    return props.kind === "directory" ? (
      <FolderIcon className={cn("size-4 text-icon-muted", props.className)} />
    ) : (
      <FileIcon className={cn("size-4 text-icon-muted", props.className)} />
    );
  }

  const color = resolvePierreIconColor(icon.token, props.theme);
  return (
    <svg
      aria-hidden="true"
      data-pierre-icon={icon.name}
      data-icon-token={icon.token}
      className={cn("size-4 shrink-0", props.className)}
      style={{ color }}
      viewBox="0 0 16 16"
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
});
