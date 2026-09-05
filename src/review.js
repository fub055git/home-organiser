// Review cadence and overdue maths. Pure -- no DOM, no IndexedDB.

// Room types with a default review interval. Everything else is manual only:
// reviewDue is set by hand in the location form, or left empty.
export const CADENCE_MONTHS = {
  wardrobe: 3,
  linen_cupboard: 3,
  garage: 12,
  utility_cupboard: 12,
};

/** Months until the next review for a room type, or null if it has no default. */
export const cadenceFor = (roomType) =>
  roomType && Object.hasOwn(CADENCE_MONTHS, roomType) ? CADENCE_MONTHS[roomType] : null;

/**
 * Today as a local YYYY-MM-DD.
 *
 * Deliberately NOT new Date().toISOString().slice(0, 10): that converts to
 * UTC first, so anywhere ahead of UTC -- all of Australia -- it returns
 * yesterday's date for the first ten or eleven hours of every day.
 */
export function todayISO(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Add whole months to a YYYY-MM-DD, clamping to the last day of the target
 * month.
 *
 * 31 January + 1 month has no correct answer. Date.setMonth rolls over and
 * gives 3 March, which is not what anyone means by "next month"; clamping
 * gives 28 February.
 */
export function addMonths(iso, months) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!parts) return null;
  const [, y, m, d] = parts;
  const target = Number(m) - 1 + Number(months);
  const year = Number(y) + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(Number(d), lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Has the review date passed? Due *today* is not yet overdue.
 * ISO dates compare correctly as plain strings, which is the whole reason
 * they are stored that way.
 */
export const isOverdue = (reviewDue, today = todayISO()) =>
  Boolean(reviewDue) && reviewDue < today;

export const overdueLocations = (locations, today = todayISO()) =>
  locations.filter((l) => isOverdue(l.reviewDue, today));
