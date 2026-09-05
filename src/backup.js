// Export and import -- the only backup this app has.
//
// Export alone is a printout, not a backup: with no backend, a cleared
// browser store is unrecoverable without a way back in. So import ships in
// the same stage as the schema, not later.
//
// Everything except downloadText/readFile is pure enough to run in node,
// which is how the tests cover the photo codec and the repair pass.

import {
  SCHEMA_VERSION, EXPORT_KIND,
  normaliseLocation, normaliseCategory, normaliseItem,
  migrate,
} from './schema.js';

// A photo is the one field that is not JSON. JSON has no binary type, so a
// Blob is base64'd into a tagged envelope on the way out and rebuilt on the
// way in. The tag is what tells import "this is a photo" rather than guessing.
export const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function encodePhoto(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  // Chunked: String.fromCharCode(...bytes) on a multi-megabyte photo blows
  // the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { __blob: 1, mime: blob.type || 'application/octet-stream', data: btoa(bin) };
}

/**
 * Rebuild a photo Blob from its envelope. Returns null for anything that is
 * not a well-formed envelope carrying an allowed image type.
 *
 * The type is taken from the allowlist, not from the file: a `blob:` URL
 * inherits this app's origin, so a Blob that claimed to be text/html and
 * later reached an iframe or a link would run with access to the database.
 * Rendering only ever happens in <img>, and this is the second lock.
 */
export function decodePhoto(env) {
  if (!env || typeof env !== 'object' || env.__blob !== 1) return null;
  if (!ALLOWED_PHOTO_MIME.includes(env.mime)) return null;
  let bin;
  try {
    bin = atob(String(env.data || ''));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: env.mime });
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '');

/** Build an export document from the current store contents. */
export async function buildExport({ locations, categories, items }) {
  const outItems = [];
  for (const raw of items) {
    const it = normaliseItem(raw);
    outItems.push({ ...it, photo: await encodePhoto(raw.photo) });
  }
  return {
    kind: EXPORT_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    locations: locations.map(normaliseLocation).sort(byName),
    categories: categories.map(normaliseCategory).sort(byName),
    items: outItems.sort(byName),
  };
}

/**
 * Migrate + normalise + repair an imported document.
 *
 * Structural problems (wrong file, unknown schema version) reject the whole
 * file. Referential problems are repaired and reported: a backup that has
 * been hand-edited or written by an older build should not be all-or-nothing
 * unusable, but nothing silently wrong should get in either.
 *
 * There is no relational engine here to refuse a bad reference, so this
 * function is the constraint.
 */
export function parseImport(raw) {
  let doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!doc || typeof doc !== 'object') throw new Error('Not a valid backup file.');
  if (doc.kind !== EXPORT_KIND) {
    throw new Error('Not a Home Organiser backup file.');
  }
  doc = migrate(doc);

  const warnings = [];

  const locations = (Array.isArray(doc.locations) ? doc.locations : [])
    .map(normaliseLocation)
    .filter((l) => {
      if (!l.id || !l.name) { warnings.push('Dropped a location with no id or no name.'); return false; }
      return true;
    });

  const categories = (Array.isArray(doc.categories) ? doc.categories : [])
    .map(normaliseCategory)
    .filter((c) => {
      if (!c.id || !c.name) { warnings.push('Dropped a category with no id or no name.'); return false; }
      return true;
    });

  const locationIds = new Set(locations.map((l) => l.id));
  const categoryIds = new Set(categories.map((c) => c.id));

  // A parent that no longer exists promotes the child to the top level
  // rather than dropping it -- losing a shelf should not lose the room.
  for (const l of locations) {
    if (l.parentId !== null && !locationIds.has(l.parentId)) {
      warnings.push(`"${l.name}" pointed at a missing parent; moved to the top level.`);
      l.parentId = null;
    }
    if (l.parentId === l.id) {
      warnings.push(`"${l.name}" was its own parent; moved to the top level.`);
      l.parentId = null;
    }
  }
  breakCycles(locations, warnings);

  const items = (Array.isArray(doc.items) ? doc.items : [])
    .map(normaliseItem)
    .filter((i) => {
      if (!i.id || !i.name) { warnings.push('Dropped an item with no id or no name.'); return false; }
      if (!i.locationId || !locationIds.has(i.locationId)) {
        warnings.push(`Dropped "${i.name}": its location is not in this backup.`);
        return false;
      }
      return true;
    })
    .map((i) => {
      // categoryId is optional, so a dangling one is nulled rather than
      // costing the item. locationId is required, so it cannot be.
      if (i.categoryId !== null && !categoryIds.has(i.categoryId)) {
        warnings.push(`"${i.name}" had an unknown category; cleared it.`);
        i.categoryId = null;
      }
      if (i.photo !== null && i.photo !== undefined) {
        const blob = decodePhoto(i.photo);
        if (!blob) warnings.push(`"${i.name}" had an unreadable or unsupported photo; dropped the photo.`);
        i.photo = blob;
      }
      return i;
    });

  return { locations, categories, items, warnings };
}

/**
 * Null the parentId of any location that sits on a cycle.
 *
 * Postgres would not catch this either -- a self-referencing FK permits
 * A -> B -> A quite happily. It matters because the browse tree in Stage 3
 * walks parents, and a cycle there is an infinite loop, not a wrong answer.
 */
function breakCycles(locations, warnings) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const safe = new Set();
  for (const start of locations) {
    const path = [];
    const seen = new Set();
    let node = start;
    while (node && node.parentId !== null && !safe.has(node.id)) {
      if (seen.has(node.id)) {
        warnings.push(`"${node.name}" was inside its own parent chain; moved to the top level.`);
        node.parentId = null;
        break;
      }
      seen.add(node.id);
      path.push(node);
      node = byId.get(node.parentId);
    }
    for (const n of path) safe.add(n.id);
  }
}

export const serialise = (doc) => JSON.stringify(doc, null, 2);

export function suggestedFilename(doc, ext = 'json') {
  const stamp = (doc.exportedAt || new Date().toISOString()).slice(0, 10);
  return `home-organiser-${stamp}.${ext}`;
}

// ------------------------------------------------------------------- DOM ---

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}
