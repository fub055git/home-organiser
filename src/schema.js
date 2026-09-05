// Record shapes, versioning and migrations. Pure -- no DOM, no IndexedDB,
// no Blobs. Everything here runs in plain node, which is why the tests can
// cover it without a browser.
//
// Every export carries schemaVersion, and import runs it forward through
// MIGRATIONS before the records are normalised.

export const SCHEMA_VERSION = 1;

export const EXPORT_KIND = 'home-organiser-export';

// The taxonomy is fixed in code, not stored per-record. A roomType that is
// not on this list is coerced to null rather than kept: an unknown value
// would silently fail to match any tips content later on.
export const ROOM_TYPES = [
  'bedroom',
  'wardrobe',
  'ensuite',
  'bathroom',
  'toilet',
  'kitchen',
  'dining',
  'living',
  'linen_cupboard',
  'garage',
  'utility_cupboard',
];

export const ROOM_TYPE_LABELS = {
  bedroom: 'Bedroom',
  wardrobe: 'Wardrobe',
  ensuite: 'Ensuite',
  bathroom: 'Bathroom',
  toilet: 'Toilet',
  kitchen: 'Kitchen',
  dining: 'Dining',
  living: 'Living',
  linen_cupboard: 'Linen cupboard',
  garage: 'Garage',
  utility_cupboard: 'Utility cupboard',
};

const str = (x) => (x === null || x === undefined || x === '' ? null : String(x));

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const count = (x, fallback = 1) => {
  const n = Math.trunc(Number(x));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Each normalise* picks its fields explicitly rather than spreading the input.
// That is what keeps an imported record from carrying along keys we never
// asked for -- including `__proto__`, which a spread or deep merge would
// happily write through onto Object.prototype.

export function normaliseLocation(l) {
  const src = l || {};
  return {
    id: str(src.id),
    name: str(src.name),
    parentId: str(src.parentId),
    roomType: ROOM_TYPES.includes(src.roomType) ? src.roomType : null,
    reviewDue: isDate(src.reviewDue) ? src.reviewDue : null,
  };
}

export function normaliseCategory(c) {
  const src = c || {};
  return {
    id: str(src.id),
    name: str(src.name),
  };
}

// `photo` is passed through untouched. In the store it is a Blob; in an
// export document it is the envelope built by backup.js. Keeping the codec
// out of here is what lets this file stay pure.
export function normaliseItem(i) {
  const src = i || {};
  return {
    id: str(src.id),
    name: str(src.name),
    locationId: str(src.locationId),
    categoryId: str(src.categoryId),
    quantity: count(src.quantity, 1),
    notes: str(src.notes),
    expiryDate: isDate(src.expiryDate) ? src.expiryDate : null,
    photo: src.photo ?? null,
  };
}

/**
 * Comparison key for user-typed names: trimmed and case-folded.
 *
 * IndexedDB could enforce uniqueness with a unique index, but a violation
 * aborts the whole transaction with an opaque ConstraintError -- which would
 * make one duplicate name in an old backup fail an entire restore. So
 * uniqueness is checked here instead, where it can name the clash.
 */
export const nameKey = (s) => String(s ?? '').trim().toLowerCase();

/** The record in `list` whose name collides with `name`, ignoring `exceptId`. */
export const findByName = (list, name, exceptId = null) =>
  list.find((x) => x.id !== exceptId && nameKey(x.name) === nameKey(name)) || null;

// Each entry migrates FROM its key version TO key+1. Empty at v1 -- the loop
// below is here so that adding a v2 later is a one-line change rather than a
// rewrite of the import path.
export const MIGRATIONS = {};

/** Run a document forward to SCHEMA_VERSION. Throws if it is newer than we know. */
export function migrate(doc) {
  let v = doc.schemaVersion;
  if (!Number.isFinite(v)) {
    throw new Error('Backup file is missing its schema version.');
  }
  if (v > SCHEMA_VERSION) {
    throw new Error(
      `This backup was written by a newer version of the app (schema ${v}, this app reads ${SCHEMA_VERSION}). Update the app before importing.`
    );
  }
  let out = doc;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema version ${v}.`);
    out = step(out);
    v = out.schemaVersion;
  }
  return out;
}
