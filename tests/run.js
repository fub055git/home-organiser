// Plain-node test run. No framework, no dependencies: `npm test` or `node tests/run.js`.
//
// Everything under test is the pure half: record shapes, migrations, the
// photo codec and the referential repair pass. The IndexedDB half needs a
// browser and is checked by hand on the Stage 1 screen.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, posix } from 'node:path';

import {
  SCHEMA_VERSION, EXPORT_KIND, ROOM_TYPES,
  normaliseLocation, normaliseItem, migrate,
  nameKey, findByName,
} from '../src/schema.js';
import {
  buildExport, parseImport, encodePhoto, decodePhoto, ALLOWED_PHOTO_MIME,
} from '../src/backup.js';
import {
  childrenOf, ancestorsOf, descendantsOf, wouldCycle, eligibleParents, itemsIn, itemsWithCategory,
  pathOf, searchItems,
} from '../src/tree.js';
import { fitWithin } from '../src/photo.js';
import { TIPS, tipsFor } from '../src/tips.js';
import { addMonths, todayISO, isOverdue, cadenceFor, overdueLocations } from '../src/review.js';

let passed = 0;
const failures = [];
const pending = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(() => { passed++; }, (err) => failures.push({ name, err })));
    } else {
      passed++;
    }
  } catch (err) {
    failures.push({ name, err });
  }
}

const doc = (over = {}) => ({
  kind: EXPORT_KIND,
  schemaVersion: SCHEMA_VERSION,
  exportedAt: '2026-09-05T00:00:00.000Z',
  locations: [],
  categories: [],
  items: [],
  ...over,
});

const loc = (id, name, over = {}) => ({ id, name, parentId: null, roomType: null, reviewDue: null, ...over });
const item = (id, name, locationId, over = {}) =>
  ({ id, name, locationId, categoryId: null, quantity: 1, notes: null, expiryDate: null, photo: null, ...over });

// --------------------------------------------------------------- shapes ---

test('roomType outside the taxonomy is coerced to null', () => {
  assert.equal(normaliseLocation({ id: 'a', name: 'X', roomType: 'study' }).roomType, null);
  assert.equal(normaliseLocation({ id: 'a', name: 'X', roomType: 'garage' }).roomType, 'garage');
  assert.equal(ROOM_TYPES.length, 11);
});

test('reviewDue only accepts YYYY-MM-DD', () => {
  assert.equal(normaliseLocation({ id: 'a', name: 'X', reviewDue: '2026-12-01' }).reviewDue, '2026-12-01');
  assert.equal(normaliseLocation({ id: 'a', name: 'X', reviewDue: '01/12/2026' }).reviewDue, null);
  assert.equal(normaliseLocation({ id: 'a', name: 'X', reviewDue: new Date() }).reviewDue, null);
});

test('quantity coerces to a non-negative integer, defaulting to 1', () => {
  assert.equal(normaliseItem({ quantity: '40' }).quantity, 40);
  assert.equal(normaliseItem({ quantity: 2.7 }).quantity, 2);
  assert.equal(normaliseItem({ quantity: -3 }).quantity, 1);
  assert.equal(normaliseItem({ quantity: 'lots' }).quantity, 1);
  assert.equal(normaliseItem({ quantity: 0 }).quantity, 0, 'zero is a legitimate count');
});

test('empty strings normalise to null, not ""', () => {
  assert.equal(normaliseItem({ id: 'i', name: 'X', notes: '' }).notes, null);
  assert.equal(normaliseLocation({ id: 'a', name: 'X', parentId: '' }).parentId, null);
});

// ------------------------------------------------------------ file gate ---

test('a file that is not ours is rejected', () => {
  assert.throws(() => parseImport('{"kind":"reference-tracker-export","schemaVersion":1}'), /Not a Home Organiser backup/);
  assert.throws(() => parseImport('{}'), /Not a Home Organiser backup/);
});

test('a newer schema version is refused rather than guessed at', () => {
  assert.throws(() => migrate({ schemaVersion: SCHEMA_VERSION + 1 }), /newer version of the app/);
});

test('a missing schema version is refused', () => {
  assert.throws(() => migrate({}), /missing its schema version/);
});

// ---------------------------------------------------- referential repair ---

test('an item whose location is missing is dropped and reported', () => {
  const r = parseImport(doc({
    locations: [loc('l1', 'Garage')],
    items: [item('i1', 'Drill', 'l1'), item('i2', 'Ghost', 'nope')],
  }));
  assert.deepEqual(r.items.map((i) => i.id), ['i1']);
  assert.match(r.warnings.join(' '), /Ghost/);
});

test('an item whose category is missing keeps the item and clears the category', () => {
  const r = parseImport(doc({
    locations: [loc('l1', 'Garage')],
    items: [item('i1', 'Drill', 'l1', { categoryId: 'gone' })],
  }));
  assert.equal(r.items.length, 1, 'categoryId is optional, so it cannot cost the item');
  assert.equal(r.items[0].categoryId, null);
  assert.match(r.warnings.join(' '), /unknown category/);
});

test('a location pointing at a missing parent is promoted, not dropped', () => {
  const r = parseImport(doc({ locations: [loc('l2', 'Shelf 2', { parentId: 'gone' })] }));
  assert.equal(r.locations.length, 1);
  assert.equal(r.locations[0].parentId, null);
});

test('a location that is its own parent is promoted', () => {
  const r = parseImport(doc({ locations: [loc('l1', 'Loop', { parentId: 'l1' })] }));
  assert.equal(r.locations[0].parentId, null);
});

test('a parentId cycle is broken so the browse tree cannot hang', () => {
  const r = parseImport(doc({
    locations: [
      loc('a', 'A', { parentId: 'b' }),
      loc('b', 'B', { parentId: 'c' }),
      loc('c', 'C', { parentId: 'a' }),
    ],
  }));
  // Walking up from every node must terminate.
  const byId = new Map(r.locations.map((l) => [l.id, l]));
  for (const start of r.locations) {
    let node = start, hops = 0;
    while (node && node.parentId !== null) {
      node = byId.get(node.parentId);
      assert.ok(++hops < 10, 'parent chain did not terminate');
    }
  }
  assert.match(r.warnings.join(' '), /parent chain/);
});

test('rows with no id or no name are dropped and reported', () => {
  const r = parseImport(doc({
    locations: [loc('l1', 'Garage'), loc(null, 'No id'), loc('l3', null)],
  }));
  assert.deepEqual(r.locations.map((l) => l.id), ['l1']);
  assert.equal(r.warnings.length, 2);
});

test('__proto__ in an imported record does not reach Object.prototype', () => {
  // Built as text on purpose: a JS object literal with __proto__ sets the
  // prototype instead of creating the own property JSON.parse would.
  const raw = '{"kind":"' + EXPORT_KIND + '","schemaVersion":1,"locations":' +
    '[{"id":"l1","name":"Garage","__proto__":{"polluted":true}}],"categories":[],"items":[]}';
  const r = parseImport(raw);
  assert.equal(r.locations.length, 1);
  assert.equal({}.polluted, undefined, 'Object.prototype was polluted');
});

// ------------------------------------------------------------- photos ---

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 254, 255]);

test('a photo survives the base64 round-trip byte for byte', async () => {
  const env = await encodePhoto(new Blob([bytes], { type: 'image/png' }));
  assert.equal(env.__blob, 1);
  assert.equal(env.mime, 'image/png');
  const back = decodePhoto(env);
  assert.equal(back.type, 'image/png');
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), bytes);
});

test('a photo claiming a non-image type is refused', () => {
  assert.equal(decodePhoto({ __blob: 1, mime: 'text/html', data: btoa('<script>x</script>') }), null);
  assert.equal(decodePhoto({ __blob: 1, mime: 'image/svg+xml', data: btoa('<svg/>') }), null,
    'SVG is script-capable, so it stays off the allowlist');
  assert.ok(ALLOWED_PHOTO_MIME.every((m) => m.startsWith('image/')));
});

test('a malformed photo envelope decodes to null rather than throwing', () => {
  assert.equal(decodePhoto(null), null);
  assert.equal(decodePhoto({ mime: 'image/png', data: 'AAAA' }), null, 'no __blob tag');
  assert.equal(decodePhoto({ __blob: 1, mime: 'image/png', data: 'not base64!!' }), null);
});

test('an unreadable photo costs the photo, not the item', async () => {
  const r = parseImport(doc({
    locations: [loc('l1', 'Garage')],
    items: [item('i1', 'Drill', 'l1', { photo: { __blob: 1, mime: 'text/html', data: btoa('x') } })],
  }));
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].photo, null);
  assert.match(r.warnings.join(' '), /unsupported photo/);
});

// --------------------------------------------------------- round trip ---

test('export then import returns the same records', async () => {
  const store = {
    locations: [
      loc('l1', 'Double Lock-up Garage', { roomType: 'garage', reviewDue: '2027-01-15' }),
      loc('l2', 'DLUG Shelf 2', { parentId: 'l1' }),
    ],
    categories: [{ id: 'c1', name: 'Tools' }],
    items: [
      item('i1', 'Cordless drill', 'l2', { categoryId: 'c1', quantity: 1, notes: 'Charger in same box' }),
      item('i2', 'Picture hooks', 'l2', { categoryId: 'c1', quantity: 40 }),
    ],
  };

  const exported = await buildExport(store);
  const back = parseImport(JSON.parse(JSON.stringify(exported)));

  assert.deepEqual(back.warnings, [], 'a clean backup should need no repair');
  assert.equal(back.locations.length, 2);
  assert.equal(back.items.length, 2);

  const drill = back.items.find((i) => i.id === 'i1');
  assert.equal(drill.name, 'Cordless drill');
  assert.equal(drill.quantity, 1);
  assert.equal(drill.notes, 'Charger in same box');
  assert.equal(drill.locationId, 'l2');
  assert.equal(drill.categoryId, 'c1');

  const garage = back.locations.find((l) => l.id === 'l1');
  assert.equal(garage.roomType, 'garage');
  assert.equal(garage.reviewDue, '2027-01-15');
  assert.equal(back.locations.find((l) => l.id === 'l2').parentId, 'l1');
});

test('a photo survives a full export/import round trip', async () => {
  const store = {
    locations: [loc('l1', 'Garage')],
    categories: [],
    items: [item('i1', 'Drill', 'l1', { photo: new Blob([bytes], { type: 'image/jpeg' }) })],
  };
  const exported = await buildExport(store);
  assert.equal(exported.items[0].photo.mime, 'image/jpeg');

  const back = parseImport(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(new Uint8Array(await back.items[0].photo.arrayBuffer()), bytes);
});

// --------------------------------------------------------------- tree ---

const TREE = [
  loc('house', 'Master Bedroom'),
  loc('wir', 'Walk-in Robe', { parentId: 'house' }),
  loc('shelf', 'WIR Shelf', { parentId: 'wir' }),
  loc('garage', 'Double Lock-up Garage'),
];

test('childrenOf returns direct children only', () => {
  assert.deepEqual(childrenOf(TREE, 'house').map((l) => l.id), ['wir']);
  assert.deepEqual(childrenOf(TREE, null).map((l) => l.id), ['house', 'garage']);
});

test('ancestorsOf returns the breadcrumb trail, outermost first', () => {
  assert.deepEqual(ancestorsOf(TREE, 'shelf').map((l) => l.id), ['house', 'wir']);
  assert.deepEqual(ancestorsOf(TREE, 'house'), []);
});

test('descendantsOf reaches every depth', () => {
  assert.deepEqual(descendantsOf(TREE, 'house').map((l) => l.id).sort(), ['shelf', 'wir']);
  assert.deepEqual(descendantsOf(TREE, 'shelf'), []);
});

test('wouldCycle catches direct and indirect loops', () => {
  assert.equal(wouldCycle(TREE, 'house', 'house'), true, 'own parent');
  assert.equal(wouldCycle(TREE, 'house', 'wir'), true, 'parent is a child');
  assert.equal(wouldCycle(TREE, 'house', 'shelf'), true, 'parent is a grandchild');
  assert.equal(wouldCycle(TREE, 'house', 'garage'), false, 'unrelated branch is fine');
  assert.equal(wouldCycle(TREE, 'house', null), false, 'top level is always fine');
});

test('eligibleParents excludes the location and everything under it', () => {
  assert.deepEqual(eligibleParents(TREE, 'house').map((l) => l.id), ['garage']);
  assert.deepEqual(eligibleParents(TREE, 'garage').map((l) => l.id), ['house', 'wir', 'shelf']);
  assert.equal(eligibleParents(TREE, null).length, 4, 'a new location may go anywhere');
});

test('tree walks terminate even on corrupt data', () => {
  const corrupt = [loc('a', 'A', { parentId: 'b' }), loc('b', 'B', { parentId: 'a' })];
  assert.doesNotThrow(() => ancestorsOf(corrupt, 'a'));
  assert.doesNotThrow(() => descendantsOf(corrupt, 'a'));
  assert.doesNotThrow(() => eligibleParents(corrupt, 'a'));
});

test('itemsIn counts only what sits directly in a location', () => {
  const items = [item('i1', 'Drill', 'shelf'), item('i2', 'Tent', 'garage')];
  assert.deepEqual(itemsIn(items, 'shelf').map((i) => i.id), ['i1']);
  assert.deepEqual(itemsIn(items, 'house'), [], 'not recursive — children guard the parent');
});

// --------------------------------------------------------- categories ---

test('nameKey folds case and trims, so near-duplicates collide', () => {
  assert.equal(nameKey('Tools'), nameKey('  tools '));
  assert.equal(nameKey('Tools'), nameKey('TOOLS'));
  assert.notEqual(nameKey('Tools'), nameKey('Tool'));
  assert.equal(nameKey(null), '');
});

test('findByName spots a clash but ignores the record being edited', () => {
  const cats = [{ id: 'c1', name: 'Tools' }, { id: 'c2', name: 'Camping' }];
  assert.equal(findByName(cats, ' TOOLS ')?.id, 'c1');
  assert.equal(findByName(cats, 'Linen'), null);
  // renaming "Tools" to "Tools" must not collide with itself
  assert.equal(findByName(cats, 'Tools', 'c1'), null);
  assert.equal(findByName(cats, 'Camping', 'c1')?.id, 'c2', 'still clashes with a different record');
});

test('itemsWithCategory finds exactly the affected items', () => {
  const items = [
    item('i1', 'Drill', 'l1', { categoryId: 'c1' }),
    item('i2', 'Tent', 'l1', { categoryId: 'c2' }),
    item('i3', 'Odds', 'l1'),
  ];
  assert.deepEqual(itemsWithCategory(items, 'c1').map((i) => i.id), ['i1']);
  assert.deepEqual(itemsWithCategory(items, 'nope'), []);
  assert.deepEqual(itemsWithCategory(items, null).map((i) => i.id), ['i3'],
    'uncategorised items are the null bucket, not a match for every id');
});

// ------------------------------------------------------------- review ---

test('addMonths clamps to the last day of the target month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'setMonth would roll over to 3 March');
  assert.equal(addMonths('2026-01-31', 3), '2026-04-30', 'April has 30 days');
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonths('2026-05-31', 3), '2026-08-31', 'no clamp needed when the day exists');
});

test('addMonths handles leap years', () => {
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28', 'the 29th does not exist in 2025');
  assert.equal(addMonths('2024-02-29', 48), '2028-02-29', '2028 is a leap year');
  assert.equal(addMonths('2026-01-30', 1), '2026-02-28');
});

test('addMonths rolls the year over correctly', () => {
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-09-05', 12), '2027-09-05');
  assert.equal(addMonths('2026-12-31', 1), '2027-01-31');
});

test('addMonths rejects anything that is not a plain ISO date', () => {
  assert.equal(addMonths('05/09/2026', 3), null);
  assert.equal(addMonths(null, 3), null);
  assert.equal(addMonths('', 3), null);
});

test('todayISO uses the local calendar date, not the UTC one', () => {
  const justAfterMidnight = new Date(2026, 0, 5, 0, 30);
  assert.equal(todayISO(justAfterMidnight), '2026-01-05');
  if (justAfterMidnight.getTimezoneOffset() < 0) {
    // Only meaningful when running ahead of UTC -- try TZ=Australia/Sydney.
    assert.notEqual(
      justAfterMidnight.toISOString().slice(0, 10),
      todayISO(justAfterMidnight),
      'this is exactly the bug todayISO exists to avoid',
    );
  }
});

test('due today is not yet overdue', () => {
  assert.equal(isOverdue('2026-09-05', '2026-09-05'), false, 'due today is due, not overdue');
  assert.equal(isOverdue('2026-09-04', '2026-09-05'), true);
  assert.equal(isOverdue('2026-09-06', '2026-09-05'), false);
  assert.equal(isOverdue(null, '2026-09-05'), false, 'no date set is never overdue');
});

test('cadence is only defined for the four room types that have one', () => {
  assert.equal(cadenceFor('wardrobe'), 3);
  assert.equal(cadenceFor('linen_cupboard'), 3);
  assert.equal(cadenceFor('garage'), 12);
  assert.equal(cadenceFor('utility_cupboard'), 12);
  for (const t of ['bedroom', 'ensuite', 'bathroom', 'toilet', 'kitchen', 'dining', 'living']) {
    assert.equal(cadenceFor(t), null, `${t} should be manual only`);
  }
  assert.equal(cadenceFor(null), null);
  assert.equal(cadenceFor('constructor'), null, 'inherited properties are not a cadence');
});

test('overdueLocations picks out exactly the lapsed ones', () => {
  const locs = [
    loc('a', 'Walk-in Robe', { reviewDue: '2026-06-01' }),
    loc('b', 'Garage', { reviewDue: '2027-01-01' }),
    loc('c', 'Kitchen'),
    loc('d', 'Linen', { reviewDue: '2026-09-05' }),
  ];
  assert.deepEqual(overdueLocations(locs, '2026-09-05').map((l) => l.id), ['a']);
});

// --------------------------------------------------------------- tips ---

test('every room type in the taxonomy has tips', () => {
  // The guard for adding a room type later and silently shipping no content
  // for it. Names the offenders rather than just failing a count.
  const missing = ROOM_TYPES.filter((t) => tipsFor(t).length === 0);
  assert.deepEqual(missing, [], 'room types with no tips');
});

test('tips are non-empty strings', () => {
  for (const [type, list] of Object.entries(TIPS)) {
    assert.ok(Array.isArray(list), `${type} should hold an array`);
    for (const tip of list) {
      assert.equal(typeof tip, 'string', `${type} has a non-string tip`);
      assert.ok(tip.trim().length > 10, `${type} has a suspiciously short tip: "${tip}"`);
    }
  }
});

test('ensuite and bathroom share one body of advice', () => {
  assert.deepEqual(tipsFor('ensuite'), tipsFor('bathroom'));
  assert.equal(TIPS.ensuite, TIPS.bathroom, 'same array, not a copy that can drift');
});

test('tipsFor returns an empty array rather than inherited junk', () => {
  assert.deepEqual(tipsFor(null), []);
  assert.deepEqual(tipsFor('study'), []);
  // a bare TIPS[key] lookup would hand back Object.prototype.constructor here
  assert.deepEqual(tipsFor('constructor'), []);
  assert.deepEqual(tipsFor('toString'), []);
});

// ------------------------------------------------------------- search ---

const FINDABLE = [
  item('i1', 'Cordless drill', 'shelf', { categoryId: 'tools', notes: 'Charger in same box' }),
  item('i2', 'Picture hooks', 'shelf', { categoryId: 'tools' }),
  item('i3', 'Tent', 'garage', { categoryId: 'camp', notes: 'Four person, green' }),
  item('i4', 'Spare HDMI cable', 'garage', { notes: 'the short one' }),
];
const ids = (list) => list.map((i) => i.id);

test('an empty query returns everything', () => {
  assert.deepEqual(ids(searchItems(FINDABLE, {})), ['i1', 'i2', 'i3', 'i4']);
  assert.deepEqual(ids(searchItems(FINDABLE, { query: '   ' })), ['i1', 'i2', 'i3', 'i4']);
});

test('search matches name and notes, case-insensitively', () => {
  assert.deepEqual(ids(searchItems(FINDABLE, { query: 'DRILL' })), ['i1']);
  assert.deepEqual(ids(searchItems(FINDABLE, { query: 'charger' })), ['i1'], 'notes are searched too');
  assert.deepEqual(ids(searchItems(FINDABLE, { query: 'short one' })), ['i4']);
  assert.deepEqual(ids(searchItems(FINDABLE, { query: 'ee' })), ['i3'], 'substring, not prefix');
});

test('category filter is tri-state: any / none / a specific id', () => {
  assert.equal(searchItems(FINDABLE, {}).length, 4, 'undefined means no filter');
  assert.deepEqual(ids(searchItems(FINDABLE, { categoryId: 'tools' })), ['i1', 'i2']);
  assert.deepEqual(ids(searchItems(FINDABLE, { categoryId: null })), ['i4'],
    'null means uncategorised, not "any category"');
});

test('query and category filter combine', () => {
  assert.deepEqual(ids(searchItems(FINDABLE, { query: 'hooks', categoryId: 'tools' })), ['i2']);
  assert.deepEqual(searchItems(FINDABLE, { query: 'hooks', categoryId: 'camp' }), []);
});

test('pathOf builds the full trail, and copes with a missing location', () => {
  assert.equal(pathOf(TREE, 'shelf'), 'Master Bedroom / Walk-in Robe / WIR Shelf');
  assert.equal(pathOf(TREE, 'garage'), 'Double Lock-up Garage');
  assert.equal(pathOf(TREE, 'nope'), '');
});

// -------------------------------------------------------------- photo ---

test('fitWithin scales the longest edge down and keeps the shape', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 }, 'portrait scales on height');
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 }, 'exactly at the cap is untouched');
});

test('fitWithin never upscales a small photo', () => {
  assert.deepEqual(fitWithin(320, 240, 1600), { width: 320, height: 240 });
});

test('fitWithin survives degenerate dimensions', () => {
  assert.deepEqual(fitWithin(0, 0, 1600), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(NaN, NaN, 1600), { width: 0, height: 0 });
  // an extreme panorama must not round its short edge away to zero
  assert.equal(fitWithin(16000, 20, 1600).height, 2);
});

// ----------------------------------------------------------- precache ---
// The ASSETS list in sw.js is hand-written. A file that is imported but not
// listed works perfectly online and 404s only once offline -- a bug that
// normal testing never sees. These two checks turn it into a red test.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// './' is the app shell, which is index.html.
const norm = (p) => p.replace(/^\.\//, '').replace(/\/$/, '') || 'index.html';

function precachedAssets() {
  const block = read('sw.js').match(/const ASSETS = \[([\s\S]*?)\n\]/);
  assert.ok(block, 'could not find the ASSETS array in sw.js');
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => norm(m[1])));
}

function referencedAssets() {
  const refs = new Set();

  for (const m of read('index.html').matchAll(/(?:src|href)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:)?\/\//.test(v) || v.startsWith('#') || v.startsWith('data:')) continue;
    refs.add(norm(v));
  }

  for (const file of readdirSync(join(ROOT, 'src'))) {
    if (!file.endsWith('.js')) continue;
    refs.add('src/' + file);
    for (const m of read(join('src', file)).matchAll(/from\s+'([^']+)'/g)) {
      if (!m[1].startsWith('.')) continue;
      refs.add(norm(posix.normalize(posix.join('src', m[1]))));
    }
  }

  // The worker is never precached: the browser fetches it directly and manages
  // its own updates. Caching it would pin the version that pins everything else.
  refs.delete('sw.js');
  return refs;
}

test('every file the app loads is in the service worker precache list', () => {
  const cached = precachedAssets();
  const missing = [...referencedAssets()].filter((r) => !cached.has(r));
  assert.deepEqual(missing, [], 'referenced but not precached — these would 404 offline');
});

test('every precached path actually exists on disk', () => {
  const missing = [...precachedAssets()].filter((p) => !existsSync(join(ROOT, p)));
  assert.deepEqual(missing, [], 'listed in sw.js ASSETS but not on disk');
});

// ------------------------------------------------------------- report ---

await Promise.all(pending);

if (failures.length) {
  for (const { name, err } of failures) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed`);
