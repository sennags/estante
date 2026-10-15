/*
 * Images are re-encoded in the browser before they are kept or sent: smaller
 * files for the account's Storage, and without the EXIF data (the GPS of a
 * phone photo). Always JPEG: Safari cannot make WebP and would hand back a PNG.
 */

/** A part of an image, in the image's own pixels. */
export type Crop = { x: number; y: number; width: number; height: number };

/** Draws `crop` of the image at width × height, halving first so a big shrink stays sharp. */
async function encode(image: ImageBitmap, crop: Crop, width: number, height: number, quality: number): Promise<Blob> {
  let source: CanvasImageSource = image;
  let { x, y, width: w, height: h } = crop;
  while (w / 2 >= width && h / 2 >= height) {
    const half = document.createElement('canvas');
    half.width = Math.round(w / 2);
    half.height = Math.round(h / 2);
    const ctx = half.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, x, y, w, h, 0, 0, half.width, half.height);
    source = half;
    [x, y, w, h] = [0, 0, half.width, half.height];
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency: a transparent PNG goes on white, not black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, w, h, 0, 0, width, height);
  image.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('canvas');
  return blob;
}

/** A JPEG of the chosen part of the image, at width × height. */
export async function cutJpeg(file: Blob, crop: Crop, width: number, height: number, quality: number) {
  return encode(await createImageBitmap(file), crop, width, height, quality);
}

/**
 * A JPEG that fills at most width × height, the way a cover is shown
 * (background-size: cover): scaled down, never up, keeping the proportion,
 * with the edges that would not show cut off evenly.
 */
export async function fillJpeg(file: Blob, width: number, height: number, quality: number) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, Math.max(width / image.width, height / image.height));
  const outW = Math.max(1, Math.min(width, Math.round(image.width * scale)));
  const outH = Math.max(1, Math.min(height, Math.round(image.height * scale)));
  const cropW = outW / scale;
  const cropH = outH / scale;
  const crop = { x: (image.width - cropW) / 2, y: (image.height - cropH) / 2, width: cropW, height: cropH };
  return encode(image, crop, outW, outH, quality);
}

/*
 * Book covers. The largest on screen is 168 × 242 CSS px (.cover-lg), so
 * 400 × 576 stays sharp on 2x screens, in a few dozen KB.
 */
export const COVER_WIDTH = 400;
export const COVER_HEIGHT = 576;
/** Covers kept before they were made smaller are shrunk when they sync. */
export const COVER_MAX_BYTES = 300 * 1024;

export const shrinkCover = (file: Blob) => fillJpeg(file, COVER_WIDTH, COVER_HEIGHT, 0.82);
