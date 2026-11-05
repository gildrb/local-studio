import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentCatalog } from "../connection/catalog";
import { assetEnvironment } from "../state/assets";
import { attachmentEnvironment } from "../state/attachments";
import { readPreparedConnection } from "../state/session";
import {
  createAttachmentUploadQueue,
  type AttachmentUploadBytesInput,
} from "./attachmentUploadQueue.logic";

const UPLOAD_TIMEOUT_MS = 5 * 60_000;

function uploadBytes(input: AttachmentUploadBytesInput): {
  readonly done: Promise<void>;
  readonly abort: () => void;
} {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("POST", input.url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", input.mimeType);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload rejected (${xhr.status})`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(input.file);
  });

  return { done, abort: () => xhr.abort() };
}

const attachmentUploadQueue = createAttachmentUploadQueue({
  registry: appAtomRegistry,
  createUploadUrl: attachmentEnvironment.createUploadUrl,
  remove: attachmentEnvironment.remove,
  createAssetUrl: (query) => assetEnvironment.createUrl(query),
  connectionStateAtom: (environmentId) => environmentCatalog.stateAtom(environmentId),
  readHttpBaseUrl: (environmentId) => readPreparedConnection(environmentId)?.httpBaseUrl ?? null,
  uploadBytes,
});

export const useAttachmentUploadStore = attachmentUploadQueue.store;
export const {
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
} = attachmentUploadQueue;
