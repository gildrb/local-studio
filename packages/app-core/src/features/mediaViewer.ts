import { assetUrlStateFromResult, type AssetUrlState } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { AssetResource, EnvironmentId, type SnapShotSource } from "@t3tools/contracts";
import {
  buildAttachmentVideoAsset,
  expandedImageFailureMessage,
  expandedMediaCaption,
  expandedMediaContentsLabel,
  wrapExpandedImageIndex,
  type ExpandedMediaAsset,
} from "@t3tools/web/src/components/chat/expandedMedia.logic.ts";
import { resolveExternalWebLinkHost } from "@t3tools/web/src/components/chat/externalLinkContextMenu.ts";
import { snapShotAccessibilityDetails } from "@t3tools/web/src/components/chat/SnapShotAttachmentDetails.logic.ts";
import { deriveUserMessageAttachments } from "@t3tools/web/src/components/chat/userMessage.logic.ts";
import {
  canRetryVideo,
  videoUnavailableLabel,
} from "@t3tools/web/src/components/media/mediaVideoPlayer.logic.ts";
import { resolveOpenMediaLink } from "@t3tools/web/src/components/media/openMediaLink.logic.ts";
import { resolveUserMessageContext } from "@t3tools/web/src/lib/composerContextRecords.ts";
import {
  isFileAttachment,
  isVideoAttachment,
  type ChatFileAttachment,
  type ChatMessage,
} from "@t3tools/web/src/types.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import type { CoreState } from "../state.ts";
import { snapShotView } from "../timelineUserRow.ts";
import type {
  MediaLinkView,
  MediaVideoView,
  MediaViewerItemView,
  MediaViewerView,
} from "../views/media.ts";

type ViewerItem = {
  readonly kind: "image" | "video";
  readonly name: string;
  readonly src: string | null;
  readonly asset: ExpandedMediaAsset | null;
  readonly srcFragment: string;
  readonly originalUrl: string | null;
  readonly autoPlay: boolean;
  readonly snapShot: SnapShotSource | null;
};

type ViewerState = {
  readonly openKey: number;
  readonly items: ReadonlyArray<ViewerItem>;
  readonly index: number;
  readonly contentsIndex: number | null;
};

const OpenParams = Schema.decodeUnknownSync(
  Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(["image", "video"]),
        name: Schema.String,
        src: Schema.NullOr(Schema.String),
        originalUrl: Schema.NullOr(Schema.String),
      }),
    ),
    index: Schema.Number,
  }),
);
const NavigateParams = Schema.decodeUnknownSync(
  Schema.Struct({ direction: Schema.Literals([-1, 1]) }),
);
const RetryParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: EnvironmentId, resource: AssetResource }),
);
const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
export type MediaRead = <A>(atom: Atom.Atom<A>) => A;

/** The signed URL state of an environment asset, as the web's `useAssetUrlState` reads it. */
export function assetUrlState(
  read: MediaRead,
  state: CoreState,
  asset: ExpandedMediaAsset,
): AssetUrlState {
  const connection = read(
    state.environmentSession.preparedConnectionValueAtom(asset.environmentId),
  );
  const result = read(
    state.assetEnvironment.createUrl({
      environmentId: asset.environmentId,
      input: { resource: asset.resource },
    }),
  );
  return assetUrlStateFromResult(
    result,
    Option.isSome(connection) ? connection.value.httpBaseUrl : null,
  );
}

function linkView(originalUrl: string | null, src: string | null): MediaLinkView | null {
  const target = resolveOpenMediaLink({ originalUrl, src });
  return target === null ? null : { url: target.url, label: target.label };
}

/** One `MediaVideoPlayer`: its source, failure copy, retry and escape hatch. */
export function mediaVideoView(input: {
  readonly label: string;
  readonly src: string | null;
  readonly sourceFailed: boolean;
  readonly originalUrl: string | null;
  readonly retry: ExpandedMediaAsset | null;
}): MediaVideoView {
  return {
    src: input.src,
    sourceFailed: input.sourceFailed,
    label: input.label,
    unavailableLabel: videoUnavailableLabel(input.label),
    canRetry: canRetryVideo(input.src, input.retry !== null),
    retry: input.retry,
    openLink: linkView(input.originalUrl, input.src),
  };
}

/** A sent video attachment's inline thumbnail source (web `UserVideoAttachment`). */
export function attachmentVideoView(
  read: MediaRead,
  state: CoreState,
  environmentId: EnvironmentId,
  file: ChatFileAttachment,
): MediaVideoView | null {
  const asset = file.downloadable === false ? null : buildAttachmentVideoAsset(environmentId, file);
  const url = asset === null ? null : assetUrlState(read, state, asset);
  const src = url?._tag === "Success" ? url.url : (file.previewUrl ?? null);
  if (asset === null && src === null) return null;
  return mediaVideoView({
    label: file.name,
    src,
    sourceFailed: file.previewUrl === undefined && asset !== null && url?._tag === "Failure",
    originalUrl: null,
    retry: asset,
  });
}

export type MediaViewerService = {
  readonly openTimelineImage: (
    message: ChatMessage,
    environmentId: EnvironmentId,
    attachmentId: string,
    scope: "grid" | "message",
  ) => void;
  readonly openTimelineVideo: (
    message: ChatMessage,
    environmentId: EnvironmentId,
    attachmentId: string,
  ) => void;
};

const services = new WeakMap<
  FeatureContext,
  MediaViewerService & { readonly feature: CoreFeature }
>();

function createMediaViewer(context: FeatureContext) {
  const { registry, state } = context;
  const stateAtom = Atom.make<ViewerState | null>(null).pipe(Atom.keepAlive);
  let openKey = 0;

  const open = (items: ReadonlyArray<ViewerItem>, index: number) => {
    if (items.length === 0) return;
    openKey += 1;
    registry.set(stateAtom, {
      openKey,
      items,
      index: wrapExpandedImageIndex(index, items.length),
      contentsIndex: null,
    });
  };

  const viewAtom = Atom.make((get): MediaViewerView | null => {
    const current = get(stateAtom);
    if (current === null) return null;
    const viewer = current.items[current.index];
    if (viewer === undefined) return null;
    const resolved = viewer.asset === null ? null : assetUrlState(get, state, viewer.asset);
    const src =
      viewer.asset === null
        ? viewer.src
        : resolved?._tag === "Success"
          ? resolved.url + viewer.srcFragment
          : null;
    const originalUrl =
      viewer.originalUrl !== null && resolveExternalWebLinkHost(viewer.originalUrl) !== null
        ? viewer.originalUrl
        : null;
    let item: MediaViewerItemView;
    if (viewer.kind === "video") {
      item = {
        kind: "video",
        autoPlay: viewer.autoPlay,
        video: mediaVideoView({
          label: viewer.name,
          src,
          sourceFailed: resolved?._tag === "Failure",
          originalUrl: viewer.originalUrl,
          retry: viewer.asset,
        }),
      };
    } else {
      const details =
        viewer.snapShot === null ? undefined : snapShotAccessibilityDetails(viewer.snapShot);
      const showing = details !== undefined && current.contentsIndex === current.index;
      const openLink = originalUrl === null ? null : linkView(originalUrl, null);
      item = {
        kind: "image",
        src,
        failureMessage: expandedImageFailureMessage(openLink !== null),
        openLink,
        snapShot: viewer.snapShot === null ? null : snapShotView(viewer.snapShot),
        contents:
          details === undefined
            ? null
            : { label: expandedMediaContentsLabel(showing, details.format), showing },
      };
    }
    return {
      itemKey: `${current.openKey}:${current.index}`,
      mediaLabel: viewer.kind,
      caption: expandedMediaCaption(viewer.name, current.index, current.items.length),
      count: current.items.length,
      item,
    };
  });

  const imageUrl = (environmentId: EnvironmentId, attachmentId: string): string | null => {
    const url = assetUrlState((atom) => registry.get(atom), state, {
      environmentId,
      resource: { _tag: "attachment", attachmentId },
    });
    return url._tag === "Success" ? url.url : null;
  };

  const service: MediaViewerService = {
    openTimelineImage: (message, environmentId, attachmentId, scope) => {
      const parts = deriveUserMessageAttachments({
        attachments: message.attachments,
        previewAttachments: message.attachments,
        context: resolveUserMessageContext(message),
      });
      const pool = scope === "grid" ? parts.regularImages : parts.userImages;
      const previewable = pool.flatMap((image) => {
        const src =
          image.previewUrl?.startsWith("blob:") || image.previewUrl?.startsWith("data:")
            ? image.previewUrl
            : (imageUrl(environmentId, image.id) ?? image.previewUrl ?? null);
        return src === null ? [] : [{ image, src }];
      });
      const index = previewable.findIndex(({ image }) => image.id === attachmentId);
      if (index < 0) return;
      open(
        previewable.map(({ image, src }) => ({
          kind: "image" as const,
          name: image.name,
          src,
          asset: null,
          srcFragment: "",
          originalUrl: null,
          autoPlay: false,
          snapShot: image.source?.kind === "snap-shot" ? image.source : null,
        })),
        index,
      );
    },
    openTimelineVideo: (message, environmentId, attachmentId) => {
      const file = message.attachments?.find((attachment) => attachment.id === attachmentId);
      if (file === undefined || !isFileAttachment(file) || !isVideoAttachment(file)) return;
      const src = file.previewUrl ?? null;
      const asset =
        file.downloadable === false ? null : buildAttachmentVideoAsset(environmentId, file);
      if (src === null && asset === null) return;
      open(
        [
          {
            kind: "video",
            name: file.name,
            src,
            asset,
            srcFragment: "",
            originalUrl: null,
            autoPlay: true,
            snapShot: null,
          },
        ],
        0,
      );
    },
  };

  const feature: CoreFeature = {
    views: { mediaViewer: viewAtom },
    actions: {
      mediaViewerOpen: async (params) => {
        const { items, index } = OpenParams(params);
        open(
          items.map((item) => ({
            kind: item.kind,
            name: item.name,
            src: item.src,
            asset: null,
            srcFragment: "",
            originalUrl: item.originalUrl,
            autoPlay: item.kind === "video",
            snapShot: null,
          })),
          index,
        );
        return null;
      },
      mediaViewerNavigate: async (params) => {
        const { direction } = NavigateParams(params);
        const current = registry.get(stateAtom);
        if (current === null || current.items.length <= 1) return null;
        registry.set(stateAtom, {
          ...current,
          index: wrapExpandedImageIndex(current.index + direction, current.items.length),
        });
        return null;
      },
      mediaViewerToggleContents: async () => {
        const current = registry.get(stateAtom);
        if (current === null) return null;
        registry.set(stateAtom, {
          ...current,
          contentsIndex: current.contentsIndex === current.index ? null : current.index,
        });
        return null;
      },
      mediaViewerClose: async () => {
        registry.set(stateAtom, null);
        return null;
      },
      mediaRetry: async (params) => {
        const { environmentId, resource } = RetryParams(params);
        await executeAtomQuery(
          registry,
          state.assetEnvironment.createUrl({ environmentId, input: { resource } }),
          { label: "Refresh media URL", reportFailure: false, refresh: true },
        );
        return null;
      },
      mediaOpenLink: async (params) => {
        await openExternal(UrlParams(params).url);
        return null;
      },
    },
  };
  return { ...service, feature };
}

export function mediaViewerService(context: FeatureContext): MediaViewerService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const created = createMediaViewer(context);
  services.set(context, created);
  return created;
}

export function createMediaViewerFeature(context: FeatureContext): CoreFeature {
  mediaViewerService(context);
  const created = services.get(context);
  if (created === undefined) throw new Error("The media viewer failed to start.");
  return created.feature;
}
