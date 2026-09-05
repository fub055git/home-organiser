// IndexedDB store of record.
//
// IndexedDB rather than localStorage because items carry photo Blobs:
// localStorage is strings only, capped around 5MB, and is not what
// navigator.storage.persist() protects.
//
// No wrapper library. At this scale -- tens of locations, hundreds of items --
// every query is "load the table and filter it in JS", so an indexed query
// DSL would buy nothing that Array.prototype does not already do.

import { wouldCycle } from './tree.js';
import { findByName } from './schema.js';

const DB_NAME = 'home-organiser';
const DB_VERSION = 1;

export const STORES = { locations: 'locations', categories: 'categories', items: 'items' };

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // Bump DB_VERSION and add a branch here when the object stores change.
      // Record-shape changes are handled by migrations in schema.js instead.
      if (e.oldVersion < 1) {
        db.createObjectStore(STORES.locations, { keyPath: 'id' })
          .createIndex('parentId', 'parentId', { unique: false });
        db.createObjectStore(STORES.categories, { keyPath: 'id' });
        const items = db.createObjectStore(STORES.items, { keyPath: 'id' });
        items.createIndex('locationId', 'locationId', { unique: false });
        items.createIndex('categoryId', 'categoryId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(store) {
  const db = await openDb();
  return wrap(tx(db, store, 'readonly').getAll());
}

async function put(store, value) {
  const db = await openDb();
  await wrap(tx(db, store, 'readwrite').put(value));
  await requestPersistOnce();
  return value;
}

async function del(store, key) {
  const db = await openDb();
  return wrap(tx(db, store, 'readwrite').delete(key));
}

export const newId = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------- records ---

export const listLocations = () => getAll(STORES.locations);
export const listCategories = () => getAll(STORES.categories);
export const listItems = () => getAll(STORES.items);

export const saveItem = (i) => put(STORES.items, { ...i, id: i.id || newId() });
export const deleteItem = (id) => del(STORES.items, id);

// ---------------------------------------------------------- integrity ---
// There is no relational engine here to refuse a bad write, so these two
// functions are the constraint. They are the ONLY exported way to write or
// remove a location: an unguarded version left in scope is one that some
// future view eventually calls by mistake.

/** Rejects a duplicate name, compared case-insensitively on the trimmed value. */
export async function saveCategory(c) {
  const name = String(c.name ?? '').trim();
  if (!name) throw new Error('Give the category a name.');
  const rec = { ...c, name, id: c.id || newId() };
  const clash = findByName(await listCategories(), name, rec.id);
  if (clash) throw new Error(`"${clash.name}" already exists.`);
  return put(STORES.categories, rec);
}

/**
 * ON DELETE SET NULL, written by hand.
 *
 * categoryId is optional, so a category going away costs the items their
 * category and nothing more -- unlike locationId, where the reference is
 * required and deletion is refused instead.
 *
 * Both stores are written in ONE transaction: clearing the references and
 * removing the category have to succeed or fail together, or a failure
 * between them leaves items pointing at a category that no longer exists.
 */
export async function deleteCategory(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction([STORES.categories, STORES.items], 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Delete aborted.'));

    const items = t.objectStore(STORES.items);
    // Items with a null categoryId are absent from this index -- IndexedDB
    // does not index records whose key path value is null -- so the cursor
    // visits exactly the affected ones.
    const req = items.index('categoryId').openCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.update({ ...cursor.value, categoryId: null });
        cursor.continue();
      } else {
        t.objectStore(STORES.categories).delete(id);
      }
    };
  });
  await requestPersistOnce();
}

/** Rejects a parent that would put a location inside itself. */
export async function saveLocation(l) {
  const rec = { ...l, id: l.id || newId() };
  if (rec.parentId) {
    if (wouldCycle(await listLocations(), rec.id, rec.parentId)) {
      throw new Error('A location cannot be placed inside itself.');
    }
  }
  return put(STORES.locations, rec);
}

/**
 * Refuses to delete a location that still holds anything.
 *
 * This is ON DELETE RESTRICT written by hand. Cascade was rejected
 * deliberately: "delete this shelf" silently erasing everything logged as
 * sitting on it is not a surprise worth the saved click.
 */
export async function deleteLocation(id) {
  const [locations, items] = await Promise.all([listLocations(), listItems()]);
  const children = locations.filter((l) => l.parentId === id);
  const held = items.filter((i) => i.locationId === id);

  if (children.length || held.length) {
    const parts = [];
    if (children.length) parts.push(`${children.length} sub-location${children.length === 1 ? '' : 's'}`);
    if (held.length) parts.push(`${held.length} item${held.length === 1 ? '' : 's'}`);
    const total = children.length + held.length;
    throw new Error(`Still holds ${parts.join(' and ')}. Move or delete ${total === 1 ? 'that' : 'those'} first.`);
  }
  return del(STORES.locations, id);
}

// ---------------------------------------------------------- bulk / import ---

export async function loadAll() {
  const [locations, categories, items] = await Promise.all([
    listLocations(), listCategories(), listItems(),
  ]);
  return { locations, categories, items };
}

export async function counts() {
  const { locations, categories, items } = await loadAll();
  return { locations: locations.length, categories: categories.length, items: items.length };
}

/**
 * Replace the entire store, in ONE transaction across all three object stores.
 *
 * The single transaction is the point: if writing the items fails halfway,
 * IndexedDB rolls back the cleared locations and categories too, so a failed
 * import leaves the previous data intact rather than a half-wiped database.
 */
export async function replaceAll({ locations, categories, items }) {
  const db = await openDb();
  const names = [STORES.locations, STORES.categories, STORES.items];
  await new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Import aborted.'));

    const locs = t.objectStore(STORES.locations);
    const cats = t.objectStore(STORES.categories);
    const its = t.objectStore(STORES.items);

    locs.clear();
    cats.clear();
    its.clear();

    for (const l of locations) locs.put(l);
    for (const c of categories) cats.put(c);
    for (const i of items) its.put(i);
  });
  await requestPersistOnce();
}

export async function clearAll() {
  await replaceAll({ locations: [], categories: [], items: [] });
}

// ------------------------------------------------------------ persistence ---
// Script-writable storage is evicted under pressure or after long inactivity.
// A house inventory is opened rarely once it is set up, so ask for a
// persistent bucket on the first write and surface the answer in the UI.

let persistAsked = false;

export async function requestPersistOnce() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return null;
  persistAsked = true;
  try {
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return already || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export async function persistenceStatus() {
  if (!navigator.storage || !navigator.storage.persisted) {
    return { supported: false, persisted: false, usage: null, quota: null };
  }
  try {
    const persisted = await navigator.storage.persisted();
    let usage = null, quota = null;
    if (navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage;
      quota = est.quota;
    }
    return { supported: true, persisted, usage, quota };
  } catch {
    return { supported: true, persisted: false, usage: null, quota: null };
  }
}
