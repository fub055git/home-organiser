// Location views: browse, drill down, create/edit.

import { el } from './ui.js';
import { ROOM_TYPES, ROOM_TYPE_LABELS } from './schema.js';
import { childrenOf, ancestorsOf, eligibleParents, itemsIn, pathOf } from './tree.js';
import { cadenceFor, addMonths, todayISO, isOverdue, overdueLocations } from './review.js';
import { itemRow } from './items.js';
import { tipsFor } from './tips.js';
import * as store from './store.js';

const roomLabel = (t) => (t ? ROOM_TYPE_LABELS[t] || t : null);

function summary(state, loc) {
  const kids = childrenOf(state.locations, loc.id).length;
  const held = itemsIn(state.items, loc.id).length;
  const bits = [];
  if (kids) bits.push(`${kids} sub-location${kids === 1 ? '' : 's'}`);
  if (held) bits.push(`${held} item${held === 1 ? '' : 's'}`);
  return bits.length ? bits.join(' · ') : 'Empty';
}

function locationRow(state, loc, ctx) {
  return el('button', {
    class: 'row',
    type: 'button',
    onClick: () => ctx.go('location/' + encodeURIComponent(loc.id)),
  },
    el('span', { class: 'row-main' },
      el('span', { class: 'row-name' }, loc.name),
      roomLabel(loc.roomType) ? el('span', { class: 'chip' }, roomLabel(loc.roomType)) : null,
      isOverdue(loc.reviewDue) ? el('span', { class: 'chip overdue' }, 'Review overdue') : null,
    ),
    el('span', { class: 'row-meta' }, summary(state, loc)),
  );
}

export function renderBrowse(state, ctx) {
  const top = childrenOf(state.locations, null);
  const overdue = overdueLocations(state.locations);

  return el('div', {},
    // Shown on the landing view because an overdue location can be nested
    // several levels down, where its own flag would never be seen.
    overdue.length ? el('div', { class: 'banner' },
      el('p', { class: 'banner-title' },
        `${overdue.length} location${overdue.length === 1 ? '' : 's'} overdue for review`),
      el('ul', {},
        overdue.map((l) => el('li', {},
          el('button', {
            type: 'button', class: 'linkish',
            onClick: () => ctx.go('location/' + encodeURIComponent(l.id)),
          }, pathOf(state.locations, l.id)),
          ` — was due ${l.reviewDue}`,
        )),
      ),
    ) : null,

    el('div', { class: 'head' },
      el('h2', {}, 'Locations'),
      el('button', { type: 'button', class: 'primary', onClick: () => ctx.go('new') }, 'Add location'),
    ),
    top.length
      ? el('div', { class: 'rows' }, top.map((l) => locationRow(state, l, ctx)))
      : el('p', { class: 'empty' }, 'No locations yet. Add a room to get started.'),
  );
}

export function renderLocation(state, id, ctx) {
  const loc = state.locations.find((l) => l.id === id);
  if (!loc) {
    return el('div', {},
      el('p', { class: 'empty' }, 'That location no longer exists.'),
      el('button', { type: 'button', onClick: () => ctx.go('') }, 'Back to locations'),
    );
  }

  const trail = ancestorsOf(state.locations, id);
  const kids = childrenOf(state.locations, id);
  const held = itemsIn(state.items, id);
  const tips = tipsFor(loc.roomType);
  const cadence = cadenceFor(loc.roomType);

  return el('div', {},
    el('nav', { class: 'crumbs' },
      el('button', { type: 'button', onClick: () => ctx.go('') }, 'Locations'),
      trail.map((a) => [
        el('span', { class: 'sep' }, '/'),
        el('button', { type: 'button', onClick: () => ctx.go('location/' + encodeURIComponent(a.id)) }, a.name),
      ]),
    ),

    el('div', { class: 'head' },
      el('h2', {}, loc.name),
      roomLabel(loc.roomType) && el('span', { class: 'chip' }, roomLabel(loc.roomType)),
    ),
    loc.reviewDue
      ? el('p', { class: isOverdue(loc.reviewDue) ? 'hint overdue-text' : 'hint' },
          isOverdue(loc.reviewDue)
            ? `Review overdue — was due ${loc.reviewDue}`
            : `Review due ${loc.reviewDue}`)
      : null,

    el('div', { class: 'actions' },
      // Only room types with a default cadence get the button. For the rest
      // there is no interval to apply, and reviewDue is set by hand in the
      // edit form rather than through a second date-picking UI.
      cadence ? el('button', {
        type: 'button',
        onClick: async () => {
          const next = addMonths(todayISO(), cadence);
          try {
            await store.saveLocation({ ...loc, reviewDue: next });
            await ctx.reload();
            ctx.toast(`Reviewed. Next due ${next}.`);
          } catch (err) {
            ctx.toast(err.message, 'bad');
          }
        },
      }, 'Mark as reviewed') : null,
      el('button', { type: 'button', class: 'primary', onClick: () => ctx.go('new/' + encodeURIComponent(id)) }, 'Add sub-location'),
      el('button', { type: 'button', onClick: () => ctx.go('edit/' + encodeURIComponent(id)) }, 'Edit'),
      el('button', {
        type: 'button', class: 'danger',
        onClick: async () => {
          if (!confirm(`Delete "${loc.name}"?`)) return;
          try {
            await store.deleteLocation(id);
            ctx.toast('Deleted.');
            const parent = trail[trail.length - 1];
            ctx.go(parent ? 'location/' + encodeURIComponent(parent.id) : '');
            await ctx.reload();
          } catch (err) {
            // The RESTRICT guard speaking. Not a crash -- a refused write.
            ctx.toast(err.message, 'bad');
          }
        },
      }, 'Delete'),
    ),

    kids.length ? el('h3', {}, 'Sub-locations') : null,
    kids.length ? el('div', { class: 'rows' }, kids.map((l) => locationRow(state, l, ctx))) : null,

    el('div', { class: 'head' },
      el('h3', {}, 'Items'),
      el('button', {
        type: 'button', class: 'primary',
        onClick: () => ctx.go('item-new/' + encodeURIComponent(id)),
      }, 'Add item'),
    ),
    held.length
      ? el('div', { class: 'rows' }, held.map((i) => itemRow(state, i, ctx)))
      : el('p', { class: 'empty' }, 'Nothing stored here yet.'),

    // Reference material, so it sits below the contents you came for.
    // <details> gives the toggle, keyboard support and screen-reader
    // semantics without a line of JavaScript.
    tips.length ? el('details', { class: 'tips' },
      el('summary', {}, `Organising tips — ${roomLabel(loc.roomType)} (${tips.length})`),
      el('ul', {}, tips.map((t) => el('li', {}, t))),
    ) : null,
  );
}

export function renderForm(state, { id = null, parentId = null }, ctx) {
  const existing = id ? state.locations.find((l) => l.id === id) : null;
  if (id && !existing) {
    return el('p', { class: 'empty' }, 'That location no longer exists.');
  }

  const startParent = existing ? existing.parentId : parentId;
  const parents = eligibleParents(state.locations, id);

  const nameInput = el('input', { type: 'text', required: true, value: existing ? existing.name : '', maxLength: 120 });
  const roomSelect = el('select', {},
    el('option', { value: '' }, '— none —'),
    ROOM_TYPES.map((t) => el('option', {
      value: t,
      selected: existing ? existing.roomType === t : false,
    }, ROOM_TYPE_LABELS[t])),
  );
  const parentSelect = el('select', {},
    el('option', { value: '' }, '— top level —'),
    parents.map((p) => el('option', {
      value: p.id,
      selected: p.id === startParent,
    }, p.name)),
  );
  const reviewInput = el('input', { type: 'date', value: existing?.reviewDue || '' });

  const form = el('form', {
    class: 'form',
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { ctx.toast('Give it a name.', 'bad'); return; }
      try {
        const saved = await store.saveLocation({
          id: existing?.id,
          name,
          parentId: parentSelect.value || null,
          roomType: roomSelect.value || null,
          reviewDue: reviewInput.value || null,
        });
        await ctx.reload();
        ctx.toast(existing ? 'Saved.' : 'Location added.');
        ctx.go('location/' + encodeURIComponent(saved.id));
      } catch (err) {
        ctx.toast(err.message, 'bad');
      }
    },
  },
    el('h2', {}, existing ? 'Edit location' : 'Add location'),
    el('label', {}, el('span', {}, 'Name'), nameInput),
    el('label', {}, el('span', {}, 'Room type'), roomSelect),
    el('label', {}, el('span', {}, 'Inside'), parentSelect),
    el('label', {}, el('span', {}, 'Review due'), reviewInput),
    el('div', { class: 'actions' },
      el('button', { type: 'submit', class: 'primary' }, existing ? 'Save' : 'Add'),
      el('button', {
        type: 'button',
        onClick: () => ctx.go(existing || parentId
          ? 'location/' + encodeURIComponent(existing ? existing.id : parentId)
          : ''),
      }, 'Cancel'),
    ),
  );

  queueMicrotask(() => nameInput.focus());
  return form;
}
