// Photo capture and downscaling.
//
// Originals are not kept. A phone photo is 3-6MB; stored as-is a few hundred
// items would make an export near a gigabyte, and base64 adds a third on top
// of that. Re-encoding at 1600px lands around 200-400KB, still enough to read
// a label inside a box.
//
// Stripping EXIF is a side effect worth having on its own: a photo taken in
// the house carries the house's GPS coordinates, and an export is a file you
// might hand to someone.

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.82;

/**
 * Scale (w, h) to fit inside `max` on its longest edge. Never upscales.
 * Pure, so the maths is testable without a canvas.
 */
export function fitWithin(w, h, max = MAX_EDGE) {
  const longest = Math.max(w, h);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= max) return { width: Math.round(w), height: Math.round(h) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** File from a camera or picker -> a downscaled JPEG Blob ready for the store. */
export async function preparePhoto(file) {
  if (!file) return null;

  let bitmap;
  try {
    // Phones store portrait shots rotated, with an EXIF flag saying so. An
    // <img> honours that flag but a canvas draw does not, so decoding with
    // 'from-image' is what stops portrait photos coming out sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That file is not an image this browser can read.');
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not process that image.');
  return blob;
}
