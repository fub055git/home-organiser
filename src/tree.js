// Pure queries over the flat lists. No DOM, no IndexedDB.
//
// The hierarchy is stored flat -- every Location carries a parentId -- so
// "the tree" only exists as the result of these functions. Keeping them pure
// is what lets node test the tricky parts (cycles, descendants, search
// matching) without a browser, and leaves the IndexedDB layer as thin glue
// around tested logic.

/** Direct children of parentId. Pass null for the top level. */
export const childrenOf = (locations, parentId = null) =>
  locations.filter((l) => l.parentId === parentId);

/** Ancestors of id, outermost first. The breadcrumb trail. */
export function ancestorsOf(locations, id) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const out = [];
  const seen = new Set([id]);
  let node = byId.get(id);
  while (node && node.parentId !== null) {
    const parent = byId.get(node.parentId);
    // Defensive: import repairs cycles, but a walk that cannot terminate is
    // a hang rather than a wrong answer, so never trust the data here.
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.unshift(parent);
    node = parent;
  }
  return out;
}

/** Everything below id, at any depth. */
export function descendantsOf(locations, id) {
  const out = [];
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    for (const l of locations) {
      if (l.parentId === current && !seen.has(l.id)) {
        seen.add(l.id);
        out.push(l);
        stack.push(l.id);
      }
    }
  }
  return out;
}

/**
 * Would making newParentId the parent of id create a loop?
 *
 * Walks up from the proposed parent looking for id. A self-referencing
 * foreign key permits A -> B -> A perfectly happily -- Postgres would not
 * have caught this either, so it is ours to catch.
 */
export function wouldCycle(locations, id, newParentId) {
  if (!newParentId) return false;
  if (newParentId === id) return true;
  const byId = new Map(locations.map((l) => [l.id, l]));
  const seen = new Set();
  let node = byId.get(newParentId);
  while (node) {
    if (node.id === id) return true;
    if (seen.has(node.id)) return false; // a pre-existing loop that excludes id
    seen.add(node.id);
    node = node.parentId === null ? null : byId.get(node.parentId);
  }
  return false;
}

/** Locations that may legally become the parent of id. */
export function eligibleParents(locations, id) {
  if (!id) return locations;
  const barred = new Set([id, ...descendantsOf(locations, id).map((l) => l.id)]);
  return locations.filter((l) => !barred.has(l.id));
}

/** Items sitting directly in a location -- not those in its sub-locations. */
export const itemsIn = (items, locationId) =>
  items.filter((i) => i.locationId === locationId);

/** Items carrying a given category. */
export const itemsWithCategory = (items, categoryId) =>
  items.filter((i) => i.categoryId === categoryId);

/** "Double Lock-up Garage / DLUG Shelf 2" -- the full trail to a location. */
export function pathOf(locations, id) {
  const loc = locations.find((l) => l.id === id);
  if (!loc) return '';
  return [...ancestorsOf(locations, id).map((a) => a.name), loc.name].join(' / ');
}

/**
 * Filter items by free text and category.
 *
 * categoryId is deliberately tri-state:
 *   undefined -> no category filter at all
 *   null      -> only items with no category
 *   "<id>"    -> only items in that category
 *
 * A linear scan on every keystroke, which at a few hundred items is instant.
 * It is the direct consequence of holding everything in memory rather than
 * querying an index -- fine here, and not how this would work at a scale a
 * house never reaches.
 */
export function searchItems(items, { query = '', categoryId } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  return items.filter((i) => {
    if (categoryId !== undefined && (i.categoryId ?? null) !== categoryId) return false;
    if (!q) return true;
    return String(i.name ?? '').toLowerCase().includes(q)
        || String(i.notes ?? '').toLowerCase().includes(q);
  });
}
