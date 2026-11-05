import { request as httpRequest, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import {
  createAttachmentUploadQueue,
  type AttachmentUploadBytesInput,
  type AttachmentUploadQueue,
} from "@t3tools/web/src/lib/attachmentUploadQueue.logic.ts";
import type { AttachmentByteUpload } from "@t3tools/client-runtime/state/attachments";
import * as Option from "effect/Option";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { CoreState } from "./state.ts";

const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export type CoreAttachmentUploads = AttachmentUploadQueue;

function uploadBytes(input: AttachmentUploadBytesInput): AttachmentByteUpload {
  const { promise: done, resolve, reject } = Promise.withResolvers<void>();
  const total = input.file.size;
  let settled = false;
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    reject(new Error(message));
  };
  let request: ClientRequest;
  try {
    const url = new URL(input.url);
    request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "POST",
      headers: { "Content-Type": input.mimeType, "Content-Length": String(total) },
      timeout: UPLOAD_TIMEOUT_MS,
    });
  } catch {
    fail("Upload failed");
    return { done, abort: () => {} };
  }
  request.on("response", (response) => {
    response.resume();
    const status = response.statusCode ?? 0;
    if (status >= 200 && status < 300) {
      if (settled) return;
      settled = true;
      resolve();
    } else {
      fail(`Upload rejected (${status})`);
    }
  });
  request.on("timeout", () => {
    fail("Upload timed out");
    request.destroy();
  });
  request.on("error", () => fail("Upload failed"));

  void (async () => {
    const reader = input.file.stream().getReader();
    let loaded = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (request.destroyed) return;
        const drained = request.write(chunk.value);
        loaded += chunk.value.byteLength;
        if (total > 0) input.onProgress(loaded / total);
        if (!drained) {
          await new Promise<void>((resume) => {
            request.once("drain", () => resume());
            request.once("close", () => resume());
          });
        }
      }
      request.end();
    } catch {
      fail("Upload failed");
      request.destroy();
    }
  })();

  return {
    done,
    abort: () => {
      fail("Upload cancelled");
      request.destroy();
    },
  };
}

export function createCoreAttachmentUploads(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: CoreState;
}): CoreAttachmentUploads {
  const { registry, state } = options;
  return createAttachmentUploadQueue({
    registry,
    createUploadUrl: state.attachmentEnvironment.createUploadUrl,
    remove: state.attachmentEnvironment.remove,
    createAssetUrl: state.assetEnvironment.createUrl,
    connectionStateAtom: state.environmentCatalog.stateAtom,
    readHttpBaseUrl: (environmentId) =>
      Option.match(
        registry.get(state.environmentSession.preparedConnectionValueAtom(environmentId)),
        {
          onNone: () => null,
          onSome: (connection) => connection.httpBaseUrl,
        },
      ),
    uploadBytes,
  });
}
