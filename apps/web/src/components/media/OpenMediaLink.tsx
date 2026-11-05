import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { Button } from "../ui/button";
import { resolveOpenMediaLink } from "./openMediaLink.logic";

/** Navigates directly so the browser handles video playback and downloads, without fetching bytes. */
export function OpenMediaLink(props: {
  readonly originalUrl?: string | undefined;
  readonly src?: string | null | undefined;
  readonly fileName?: string | undefined;
  readonly className?: string | undefined;
}) {
  const target = resolveOpenMediaLink({ originalUrl: props.originalUrl, src: props.src });
  if (target === null) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      className={props.className}
      render={
        <a
          href={target.url}
          target={target.isBlob ? undefined : "_blank"}
          download={target.isBlob ? props.fileName || true : undefined}
          rel="noopener noreferrer"
        />
      }
    >
      {target.isBlob ? <DownloadIcon /> : <ExternalLinkIcon />}
      {target.label}
    </Button>
  );
}
