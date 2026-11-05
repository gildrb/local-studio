import {
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type AttachmentCreateUploadUrlInput,
  type AttachmentCreateUploadUrlResult,
  type AttachmentDeleteInput,
  type ChatAttachment,
  type EnvironmentId,
} from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
  verifyPersistedAttachmentUpload,
  type AttachmentByteUpload,
  type PersistedAttachmentVerification,
} from "@t3tools/client-runtime/state/attachments";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import * as Option from "effect/Option";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadTarget,
} from "../composerDraftStore";
import type { AttachmentUploadState, ReadyAttachmentUpload } from "./attachmentUploadState";

const MAX_UPLOADS_PER_ENVIRONMENT = 3;

export interface AttachmentUploadStore {
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
}

export type AttachmentUploadSource = ComposerImageAttachment | ComposerFileAttachment;

export interface AttachmentUploadBytesInput {
  readonly url: string;
  readonly file: File;
  readonly mimeType: string;
  readonly onProgress: (progress: number) => void;
}

export interface AttachmentUploadQueueDeps<A, AE, CE, RE, SE> {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly createUploadUrl: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: AttachmentCreateUploadUrlInput },
    AttachmentCreateUploadUrlResult,
    CE
  >;
  readonly remove: AtomCommand<
    { readonly environmentId: EnvironmentId; readonly input: AttachmentDeleteInput },
    unknown,
    RE
  >;
  readonly createAssetUrl: (query: {
    readonly environmentId: EnvironmentId;
    readonly input: {
      readonly resource: { readonly _tag: "attachment"; readonly attachmentId: string };
    };
  }) => Atom.Atom<AsyncResult.AsyncResult<A, AE>>;
  readonly connectionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<{ readonly phase: string }, SE>>;
  readonly readHttpBaseUrl: (environmentId: EnvironmentId) => string | null;
  readonly uploadBytes: (input: AttachmentUploadBytesInput) => AttachmentByteUpload;
}

export interface StartAttachmentUploadInput {
  readonly environmentId: EnvironmentId;
  readonly image: AttachmentUploadSource;
  readonly draftTarget?: ComposerThreadTarget;
}

export interface AttachmentUploadQueue {
  readonly store: UseBoundStore<StoreApi<AttachmentUploadStore>>;
  readonly readAttachmentUpload: (imageId: string) => AttachmentUploadState | undefined;
  readonly startAttachmentUpload: (input: StartAttachmentUploadInput) => void;
  readonly releaseAttachmentUpload: (imageId: string) => void;
  readonly releasePersistedAttachmentUpload: (input: {
    readonly id: string;
    readonly environmentId: EnvironmentId;
    readonly attachmentId: string;
  }) => void;
  readonly retryAttachmentUpload: (input: StartAttachmentUploadInput) => void;
  readonly verifyStashedAttachmentUpload: (input: {
    readonly environmentId: EnvironmentId;
    readonly attachmentId: string;
  }) => Promise<PersistedAttachmentVerification>;
  readonly awaitAttachmentUploads: (imageIds: ReadonlyArray<string>) => Promise<void>;
  readonly getUploadedAttachments: (input: {
    readonly environmentId: EnvironmentId;
    readonly images: ReadonlyArray<AttachmentUploadSource>;
  }) => ChatAttachment[] | null;
  readonly releaseDraftAttachment: (attachment: AttachmentUploadSource) => void;
  readonly releaseDraftAttachments: (attachments: ReadonlyArray<AttachmentUploadSource>) => void;
}

interface UploadJob {
  readonly image: AttachmentUploadSource;
  readonly environmentId: EnvironmentId;
  /**
   * The draft that owned this file when the job started. Completion resolves
   * the current owner because the file can move while the upload is pending.
   */
  readonly draftTarget?: ComposerThreadTarget;
  readonly previous?: ReadyAttachmentUpload;
  /**
   * The draft's persisted server-side upload, to verify instead of re-upload.
   * The draft owns this id; the queue never deletes it on cancel or retry.
   * Deleting it goes through `releasePersistedAttachmentUpload` only.
   */
  readonly persistedAttachmentId?: string;
  readonly settled: Promise<void>;
  resolveSettled: () => void;
  /** Only ids this queue minted itself. Cancel and retry may delete these. */
  attachmentId: string | null;
  cancelled: boolean;
  abort: (() => void) | null;
  stopWatchingConnection: () => void;
}

export function createAttachmentUploadQueue<A, AE, CE, RE, SE>(
  deps: AttachmentUploadQueueDeps<A, AE, CE, RE, SE>,
): AttachmentUploadQueue {
  const store = create<AttachmentUploadStore>(() => ({
    uploadsByImageId: {},
  }));

  // Failed jobs retain their source and connection subscription until retry or release.
  const jobsByImageId = new Map<string, UploadJob>();
  const queue: UploadJob[] = [];
  const activeUploadsByEnvironment = new Map<EnvironmentId, number>();

  function setUploadState(imageId: string, upload: AttachmentUploadState): void {
    store.setState((state) => ({
      uploadsByImageId: { ...state.uploadsByImageId, [imageId]: upload },
    }));
  }

  function clearUploadState(imageId: string): void {
    store.setState((state) => {
      if (!(imageId in state.uploadsByImageId)) {
        return state;
      }
      const uploadsByImageId = { ...state.uploadsByImageId };
      delete uploadsByImageId[imageId];
      return { uploadsByImageId };
    });
  }

  function readAttachmentUpload(imageId: string): AttachmentUploadState | undefined {
    return store.getState().uploadsByImageId[imageId];
  }

  /** Finds the file's current same-environment draft after any in-flight move. */
  function resolveCurrentFileDraftTarget(job: UploadJob): ComposerThreadTarget | undefined {
    if (job.draftTarget === undefined || job.image.type !== "file") {
      return undefined;
    }
    const draftStore = useComposerDraftStore.getState();
    for (const [key, draft] of Object.entries(draftStore.draftsByThreadKey)) {
      if (!draft.files.some((file) => file.id === job.image.id)) {
        continue;
      }
      const draftSession = draftStore.draftThreadsByThreadKey[key];
      if (draftSession !== undefined) {
        if (draftSession.environmentId === job.environmentId) {
          return DraftId.make(key);
        }
        continue;
      }
      // Tests and legacy callers can use a DraftId without session metadata.
      // Only its original job supplies enough environment identity to trust it.
      if (typeof job.draftTarget === "string" && job.draftTarget === key) {
        return DraftId.make(key);
      }
      const threadRef = parseScopedThreadKey(key);
      if (threadRef?.environmentId === job.environmentId) {
        return threadRef;
      }
    }
    return undefined;
  }

  /**
   * Persists a finished upload's ids onto the draft that owns the file. The
   * mounted composer effect performs the same write for live UI updates, but a
   * background completion (user navigated away, upload finished, reload) must
   * not depend on a mounted composer to survive. `setFileUpload` no-ops when
   * the draft row is gone or already carries these ids.
   */
  function stampDraftFileUpload(job: UploadJob, attachmentId: string): void {
    const draftTarget = resolveCurrentFileDraftTarget(job);
    if (draftTarget === undefined) {
      return;
    }
    useComposerDraftStore
      .getState()
      .setFileUpload(draftTarget, job.image.id, job.environmentId, attachmentId);
  }

  function deletePendingUpload(environmentId: EnvironmentId, attachmentId: string): void {
    deletePendingAttachmentUpload({
      registry: deps.registry,
      remove: deps.remove,
      environmentId,
      attachmentId,
    });
  }

  async function runUpload(job: UploadJob): Promise<void> {
    if (job.persistedAttachmentId) {
      const verification = await verifyPersistedAttachmentUpload({
        registry: deps.registry,
        createAssetUrl: deps.createAssetUrl,
        environmentId: job.environmentId,
        attachmentId: job.persistedAttachmentId,
      });
      if (job.cancelled) {
        return;
      }
      if (verification.status === "verified") {
        setUploadState(job.image.id, {
          status: "ready",
          environmentId: job.environmentId,
          attachmentId: job.persistedAttachmentId,
        });
        stampDraftFileUpload(job, job.persistedAttachmentId);
        return;
      }
      if (verification.status === "missing" && !job.image.file && job.image.type === "file") {
        const draftTarget = resolveCurrentFileDraftTarget(job);
        if (
          draftTarget !== undefined &&
          useComposerDraftStore
            .getState()
            .markFileUploadMissing(
              draftTarget,
              job.image.id,
              job.environmentId,
              job.persistedAttachmentId,
            )
        ) {
          clearUploadState(job.image.id);
          return;
        }
      }
      if (verification.status === "failed" || !job.image.file) {
        // No `attachmentId` here: a failed state's id marks a pending upload
        // this queue minted, which retry and release then delete. The persisted
        // id is the only server copy of a hydrated file, so a transient
        // verification failure must leave it in place for the next retry.
        setUploadState(job.image.id, {
          status: "failed",
          environmentId: job.environmentId,
          reason:
            verification.status === "missing"
              ? "Uploaded file expired. Remove it and attach it again."
              : "Uploaded file could not be verified. Retry when the server reconnects.",
          ...(job.previous ? { previous: job.previous } : {}),
        });
        return;
      }
    }

    const mimeType =
      job.image.type === "file"
        ? job.image.mimeType.toLowerCase()
        : PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
            (supportedMimeType) => supportedMimeType === job.image.mimeType.toLowerCase(),
          );
    if (!mimeType) {
      setUploadState(job.image.id, {
        status: "failed",
        environmentId: job.environmentId,
        reason: "Unsupported image type",
        ...(job.previous ? { previous: job.previous } : {}),
      });
      return;
    }
    const file = job.image.file;
    if (!file) {
      setUploadState(job.image.id, {
        status: "failed",
        environmentId: job.environmentId,
        reason: "Original file is no longer available",
        ...(job.previous ? { previous: job.previous } : {}),
      });
      return;
    }

    let lastStep = -1;
    const result = await runAttachmentUploadCycle({
      registry: deps.registry,
      createUploadUrl: deps.createUploadUrl,
      remove: deps.remove,
      environmentId: job.environmentId,
      upload: {
        ...(job.image.type === "file" ? { type: "file" as const } : {}),
        name: job.image.name,
        mimeType,
        sizeBytes: file.size,
      },
      resolveUploadUrl: (relativeUrl) => {
        const httpBaseUrl = deps.readHttpBaseUrl(job.environmentId);
        return httpBaseUrl === null ? null : resolveAssetUrl(httpBaseUrl, relativeUrl);
      },
      transport: (url) =>
        deps.uploadBytes({
          url,
          file,
          mimeType,
          onProgress: (progress) => {
            const step = Math.floor(progress * 20);
            if (step === lastStep || job.cancelled) {
              return;
            }
            lastStep = step;
            setUploadState(job.image.id, {
              status: "uploading",
              environmentId: job.environmentId,
              progress,
              ...(job.previous ? { previous: job.previous } : {}),
            });
          },
        }),
      onMinted: (attachmentId) => {
        if (job.cancelled) {
          return "cancel";
        }
        job.attachmentId = attachmentId;
        return "continue";
      },
      onTransferStart: (abort) => {
        job.abort = abort;
      },
    });
    job.abort = null;
    if (result.status === "cancelled" || job.cancelled) {
      return;
    }
    if (result.status === "uploaded") {
      setUploadState(job.image.id, {
        status: "ready",
        environmentId: job.environmentId,
        attachmentId: result.attachmentId,
      });
      stampDraftFileUpload(job, result.attachmentId);
      if (job.previous) {
        deletePendingUpload(job.previous.environmentId, job.previous.attachmentId);
      }
      return;
    }
    setUploadState(job.image.id, {
      status: "failed",
      environmentId: job.environmentId,
      reason:
        result.step === "mint"
          ? "Upload could not start"
          : result.step === "resolve-url"
            ? "Not connected"
            : result.error instanceof Error
              ? result.error.message
              : "Upload failed",
      ...(result.attachmentId ? { attachmentId: result.attachmentId } : {}),
      ...(job.previous ? { previous: job.previous } : {}),
    });
  }

  function pumpUploads(): void {
    for (let index = 0; index < queue.length;) {
      const job = queue[index];
      if (job === undefined) {
        return;
      }
      const active = activeUploadsByEnvironment.get(job.environmentId) ?? 0;
      if (active >= MAX_UPLOADS_PER_ENVIRONMENT) {
        index += 1;
        continue;
      }

      queue.splice(index, 1);
      if (job.cancelled) {
        continue;
      }
      activeUploadsByEnvironment.set(job.environmentId, active + 1);
      void runUpload(job)
        .catch(() => {
          if (!job.cancelled) {
            setUploadState(job.image.id, {
              status: "failed",
              environmentId: job.environmentId,
              reason: "Upload failed",
              ...(job.previous ? { previous: job.previous } : {}),
            });
          }
        })
        .finally(() => {
          if (
            jobsByImageId.get(job.image.id) === job &&
            readAttachmentUpload(job.image.id)?.status !== "failed"
          ) {
            job.stopWatchingConnection();
            jobsByImageId.delete(job.image.id);
          }
          const remaining = (activeUploadsByEnvironment.get(job.environmentId) ?? 1) - 1;
          if (remaining > 0) {
            activeUploadsByEnvironment.set(job.environmentId, remaining);
          } else {
            activeUploadsByEnvironment.delete(job.environmentId);
          }
          job.resolveSettled();
          pumpUploads();
        });
    }
  }

  function startAttachmentUpload(input: StartAttachmentUploadInput): void {
    const existingJob = jobsByImageId.get(input.image.id);
    if (existingJob?.environmentId === input.environmentId) {
      return;
    }

    const existing = readAttachmentUpload(input.image.id);
    if (existing?.status === "ready" && existing.environmentId === input.environmentId) {
      return;
    }
    if (existing?.status === "failed" && existing.environmentId === input.environmentId) {
      return;
    }
    if (
      existing &&
      "previous" in existing &&
      existing.previous?.environmentId === input.environmentId
    ) {
      cancelAttachmentUpload(input.image.id);
      if (existing.status === "failed" && existing.attachmentId) {
        deletePendingUpload(existing.environmentId, existing.attachmentId);
      }
      setUploadState(input.image.id, existing.previous);
      return;
    }

    if (existingJob) {
      cancelAttachmentUpload(input.image.id);
    }
    const previous = existing?.status === "ready" ? existing : existing?.previous;
    let resolveSettled: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const job: UploadJob = {
      image: input.image,
      environmentId: input.environmentId,
      ...(input.draftTarget !== undefined ? { draftTarget: input.draftTarget } : {}),
      ...(previous ? { previous } : {}),
      ...(input.image.type === "file" &&
      input.image.uploadEnvironmentId === input.environmentId &&
      input.image.uploadedAttachmentId
        ? { persistedAttachmentId: input.image.uploadedAttachmentId }
        : {}),
      settled,
      resolveSettled,
      attachmentId: null,
      cancelled: false,
      abort: null,
      stopWatchingConnection: () => {},
    };

    jobsByImageId.set(input.image.id, job);
    const connectionAtom = deps.connectionStateAtom(job.environmentId);
    const isConnected = () =>
      Option.exists(
        AsyncResult.value(deps.registry.get(connectionAtom)),
        (state) => state.phase === "connected",
      );
    let wasConnected = isConnected();
    job.stopWatchingConnection = deps.registry.subscribe(connectionAtom, () => {
      const connected = isConnected();
      const reconnected = connected && !wasConnected;
      wasConnected = connected;
      if (!reconnected) return;
      // The HTTP failure can arrive after the socket has already reconnected.
      // Wait for that attempt, then retry only if this job still owns the file.
      void job.settled.then(() => {
        if (
          jobsByImageId.get(job.image.id) === job &&
          readAttachmentUpload(job.image.id)?.status === "failed" &&
          isConnected()
        ) {
          retryAttachmentUpload(input);
        }
      });
    });
    queue.push(job);
    setUploadState(input.image.id, {
      status: "uploading",
      environmentId: input.environmentId,
      progress: 0,
      ...(previous ? { previous } : {}),
    });
    pumpUploads();
  }

  /**
   * Stops the job and deletes only the pending upload it minted itself. A
   * persisted draft upload survives cancellation (an environment switch cancels
   * the old job, and the draft still references that server copy).
   */
  function cancelAttachmentUpload(imageId: string): void {
    const job = jobsByImageId.get(imageId);
    if (!job) {
      return;
    }
    job.cancelled = true;
    job.stopWatchingConnection();
    jobsByImageId.delete(imageId);
    const queuedIndex = queue.indexOf(job);
    if (queuedIndex !== -1) {
      queue.splice(queuedIndex, 1);
    }
    job.abort?.();
    if (job.attachmentId) {
      deletePendingUpload(job.environmentId, job.attachmentId);
    }
    job.resolveSettled();
  }

  function releaseAttachmentUpload(imageId: string): void {
    const upload = readAttachmentUpload(imageId);
    cancelAttachmentUpload(imageId);
    if (upload?.status === "ready") {
      deletePendingUpload(upload.environmentId, upload.attachmentId);
    } else if (upload) {
      if (upload.status === "failed" && upload.attachmentId) {
        deletePendingUpload(upload.environmentId, upload.attachmentId);
      }
      if (upload.previous) {
        deletePendingUpload(upload.previous.environmentId, upload.previous.attachmentId);
      }
    }
    clearUploadState(imageId);
  }

  function releasePersistedAttachmentUpload(input: {
    readonly id: string;
    readonly environmentId: EnvironmentId;
    readonly attachmentId: string;
  }): void {
    const upload = readAttachmentUpload(input.id);
    if (
      upload?.status === "ready" &&
      upload.environmentId === input.environmentId &&
      upload.attachmentId === input.attachmentId
    ) {
      releaseAttachmentUpload(input.id);
      return;
    }
    const job = jobsByImageId.get(input.id);
    if (
      job?.environmentId === input.environmentId &&
      job.persistedAttachmentId === input.attachmentId
    ) {
      // Tears down the in-flight verification or re-upload. The queue only
      // deletes ids it minted, so the persisted id still needs the delete below.
      releaseAttachmentUpload(input.id);
    }
    deletePendingUpload(input.environmentId, input.attachmentId);
  }

  function retryAttachmentUpload(input: StartAttachmentUploadInput): void {
    const previous = readAttachmentUpload(input.image.id);
    cancelAttachmentUpload(input.image.id);
    // A failed state's `attachmentId` is always one this queue minted, so this
    // never deletes a persisted draft upload. Retrying a hydrated file whose
    // verification failed leaves the server copy alone and verifies it again.
    if (previous?.status === "failed" && previous.attachmentId) {
      deletePendingUpload(previous.environmentId, previous.attachmentId);
    }
    if (previous && "previous" in previous && previous.previous) {
      setUploadState(input.image.id, previous.previous);
    } else {
      clearUploadState(input.image.id);
    }
    startAttachmentUpload(input);
  }

  /**
   * Checks that a stashed upload still exists on the server. Pending uploads
   * are swept after 24 hours, so a stash restore asks first instead of handing
   * the composer a dead reference.
   */
  function verifyStashedAttachmentUpload(input: {
    readonly environmentId: EnvironmentId;
    readonly attachmentId: string;
  }): Promise<PersistedAttachmentVerification> {
    return verifyPersistedAttachmentUpload({
      registry: deps.registry,
      createAssetUrl: deps.createAssetUrl,
      environmentId: input.environmentId,
      attachmentId: input.attachmentId,
    });
  }

  async function awaitAttachmentUploads(imageIds: ReadonlyArray<string>): Promise<void> {
    await Promise.all(imageIds.map((imageId) => jobsByImageId.get(imageId)?.settled));
  }

  function getUploadedAttachments(input: {
    readonly environmentId: EnvironmentId;
    readonly images: ReadonlyArray<AttachmentUploadSource>;
  }): ChatAttachment[] | null {
    const attachments: ChatAttachment[] = [];
    for (const image of input.images) {
      const upload = readAttachmentUpload(image.id);
      if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
        return null;
      }
      attachments.push({
        type: image.type,
        id: upload.attachmentId,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        ...(image.source ? { source: image.source } : {}),
      });
    }
    return attachments;
  }

  /**
   * The one owner for discarding a draft attachment's server-side upload. The
   * queue-keyed release only sees in-memory state, so after a reload it finds
   * nothing and the pending upload leaks. When the draft carries a persisted
   * `uploadedAttachmentId` (which survives reloads), route through the persisted
   * release; it still prefers the queue path when the queue owns that same
   * attachment. Every draft discard path must funnel through here.
   */
  function releaseDraftAttachment(attachment: AttachmentUploadSource): void {
    if (
      attachment.type === "file" &&
      attachment.uploadedAttachmentId !== undefined &&
      attachment.uploadEnvironmentId !== undefined
    ) {
      releasePersistedAttachmentUpload({
        id: attachment.id,
        environmentId: attachment.uploadEnvironmentId,
        attachmentId: attachment.uploadedAttachmentId,
      });
      // A failed re-upload after verification can hold a newer minted
      // attachment under the queue key. Release whatever is left so neither
      // copy stays behind. (The pending delete is idempotent server-side.)
      if (jobsByImageId.has(attachment.id) || readAttachmentUpload(attachment.id)) {
        releaseAttachmentUpload(attachment.id);
      }
      return;
    }
    releaseAttachmentUpload(attachment.id);
  }

  function releaseDraftAttachments(attachments: ReadonlyArray<AttachmentUploadSource>): void {
    for (const attachment of attachments) {
      releaseDraftAttachment(attachment);
    }
  }

  return {
    store,
    readAttachmentUpload,
    startAttachmentUpload,
    releaseAttachmentUpload,
    releasePersistedAttachmentUpload,
    retryAttachmentUpload,
    verifyStashedAttachmentUpload,
    awaitAttachmentUploads,
    getUploadedAttachments,
    releaseDraftAttachment,
    releaseDraftAttachments,
  };
}
