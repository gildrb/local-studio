import type { AssetResource, EnvironmentId } from "@t3tools/contracts";

import type { TimelineSnapShotView } from "./timeline.ts";

export type MediaRetryView = {
  readonly environmentId: EnvironmentId;
  readonly resource: AssetResource;
};

export type MediaLinkView = {
  readonly url: string;
  readonly label: string;
};

export type MediaVideoView = {
  readonly src: string | null;
  readonly sourceFailed: boolean;
  readonly label: string;
  readonly unavailableLabel: string;
  readonly canRetry: boolean;
  readonly retry: MediaRetryView | null;
  readonly openLink: MediaLinkView | null;
};

export type MediaViewerContentsView = {
  readonly label: string;
  readonly showing: boolean;
};

export type MediaViewerItemView =
  | {
      readonly kind: "image";
      readonly src: string | null;
      readonly failureMessage: string;
      readonly openLink: MediaLinkView | null;
      readonly snapShot: TimelineSnapShotView | null;
      readonly contents: MediaViewerContentsView | null;
    }
  | {
      readonly kind: "video";
      readonly video: MediaVideoView;
      readonly autoPlay: boolean;
    };

export type MediaViewerView = {
  readonly itemKey: string;
  readonly mediaLabel: "image" | "video";
  readonly caption: string;
  readonly count: number;
  readonly item: MediaViewerItemView;
};
