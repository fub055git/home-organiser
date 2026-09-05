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

/**
 * Decode a file to something drawable, preferring the path that applies the
 * EXIF rotation.
 *
 * Phones store portrait shots rotated with an EXIF flag saying so. Passing
 * imageOrientation is the clean way to honour it -- but Safari only accepted
 * that options argument from version 17, so older iPhones throw here. Falling
 * back to an <img> is not a downgrade: browsers apply EXIF orientation when
 * decoding an image element too.
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* older Safari rejects the options argument */ }
    try {
      return await createImageBitmap(file);
    } catch { /* fall through to the <img> path */ }
  }

  const url = URL.createObjectURL(file);
  try {
    // onload rather than decode(): decode() can stall indefinitely while the
    // document is hidden, which is exactly what happens if you switch apps
    // mid-import. onload does not depend on the page being painted.
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image could not be decoded'));
      img.src = url;
    });
  } finally {
    // Safe once loaded: the pixels are already in memory.
    URL.revokeObjectURL(url);
  }
}

/** File from a camera or picker -> a downscaled JPEG Blob ready for the store. */
export async function preparePhoto(file) {
  if (!file) return null;
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error(`That file is ${file.type}, not an image.`);
  }

  let source;
  try {
    source = await decodeImage(file);
  } catch (err) {
    // Carry the underlying reason: on a phone there is no console to check.
    throw new Error(`Could not read that image${err?.message ? ` (${err.message})` : ''}.`);
  }

  const { width, height } = fitWithin(
    source.naturalWidth || source.width,
    source.naturalHeight || source.height,
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close(); // ImageBitmap only

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not process that image.');
  return blob;
}
