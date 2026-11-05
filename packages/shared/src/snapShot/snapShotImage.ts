export type SnapShotSize = { readonly width: number; readonly height: number };

export type SnapShotRectangle = SnapShotSize & { readonly x: number; readonly y: number };

export type SnapShotDecodedImage = SnapShotSize & {
  readonly resize: (size: SnapShotSize) => Promise<Buffer>;
};

/** Decodes captured PNGs. Each host supplies its platform's image codec. */
export type SnapShotImageCodec = {
  /** The decoded image, or `undefined` when the bytes are empty or unreadable. */
  readonly open: (png: Buffer) => SnapShotDecodedImage | undefined;
};

export type NativeImageLike = {
  readonly isEmpty: () => boolean;
  readonly getSize: () => SnapShotSize;
  readonly resize: (options: SnapShotSize & { readonly quality: "best" }) => {
    readonly toPNG: () => Buffer;
  };
};

/** Adapts an Electron-style `nativeImage.createFromBuffer` into a snapshot codec. */
export function snapShotImageCodecFromNativeImage(
  createFromBuffer: (png: Buffer) => NativeImageLike,
): SnapShotImageCodec {
  return {
    open: (png) => {
      const image = createFromBuffer(png);
      if (image.isEmpty()) return undefined;
      const { width, height } = image.getSize();
      return {
        width,
        height,
        resize: async (size) => image.resize({ ...size, quality: "best" }).toPNG(),
      };
    },
  };
}

let installedCodec: SnapShotImageCodec | undefined;

export function setSnapShotImageCodec(codec: SnapShotImageCodec): void {
  installedCodec = codec;
}

export function snapShotImageCodec(): SnapShotImageCodec {
  if (!installedCodec) throw new Error("No snapshot image codec is installed.");
  return installedCodec;
}

/** Scale an image down to fit `maxSize`, keeping its aspect ratio; smaller images pass through. */
export async function fitSnapShotImage(
  image: SnapShotDecodedImage,
  png: Buffer,
  maxSize: SnapShotSize,
): Promise<Buffer> {
  const scale = Math.min(maxSize.width / image.width, maxSize.height / image.height, 1);
  return scale < 1
    ? image.resize({
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
      })
    : png;
}
