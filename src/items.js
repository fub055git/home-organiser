// Item views. The form doubles as the detail view -- an item has six fields
// and all of them are editable, so a read-only page would show the same
// information with less to do on it.

import { el, clear, objectUrl } from './ui.js';
import { preparePhoto } from './photo.js';
import { pathOf } from './tree.js';
import { ITEM_SUGGESTIONS, categoryForItem } from './suggestions.js';
import { findByName } from './schema.js';
import * as store from './store.js';

/** One item as a row inside its location. */
export function itemRow(state, it, ctx) {
  const cat = it.categoryId ? state.categories.find((c) => c.id === it.categoryId) : null;
  const meta = [];
  if (it.quantity !== 1) meta.push('×' + it.quantity);
  if (it.expiryDate) meta.push('expires ' + it.expiryDate);

  return el('button', {
    class: 'row item-row',
    type: 'button',
    onClick: () => ctx.go('item/' + encodeURIComponent(it.id)),
  },
    it.photo
      ? el('img', { class: 'thumb', src: objectUrl(it.photo), alt: '' })
      : el('span', { class: 'thumb thumb-empty', 'aria-hidden': 'true' }),
    el('span', { class: 'row-main' },
      el('span', { class: 'row-name' }, it.name),
      cat && el('span', { class: 'chip' }, cat.name),
    ),
    // Ternary, not `meta.length && ...`: an empty array gives 0, which is
    // falsy but is still a perfectly renderable number, so el() appends "0".
    meta.length ? el('span', { class: 'row-meta' }, meta.join(' · ')) : null,
  );
}

export function renderItemForm(state, { id = null, locationId = null }, ctx) {
  const existing = id ? state.items.find((i) => i.id === id) : null;
  if (id && !existing) {
    return el('p', { class: 'empty' }, 'That item no longer exists.');
  }

  // Photo lives in a local variable until Save, so cancelling really cancels.
  let photo = existing ? existing.photo : null;
  const startLocation = existing ? existing.locationId : locationId;

  // Suggestions only: the field still accepts anything typed.
  const nameList = el('datalist', { id: 'common-items' },
    ITEM_SUGGESTIONS.map((name) => el('option', { value: name })));
  const nameInput = el('input', {
    type: 'text', required: true, maxLength: 120,
    value: existing?.name || '',
    list: 'common-items',
    autocomplete: 'off',
  });
  const qtyInput = el('input', { type: 'number', min: 0, step: 1, value: String(existing?.quantity ?? 1) });
  const notesInput = el('textarea', { rows: 3, maxLength: 2000 }, existing?.notes || '');
  const expiryInput = el('input', { type: 'date', value: existing?.expiryDate || '' });

  const categorySelect = el('select', {},
    el('option', { value: '' }, '— none —'),
    [...state.categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
      el('option', { value: c.id, selected: existing?.categoryId === c.id }, c.name)),
  );

  // Picking a suggested name proposes its category, which is what stops
  // categories being a field nobody ever fills in. It only ever fills an
  // empty selection -- a deliberate choice is never overridden -- and a
  // category that does not exist yet is marked "(new)" so nothing is created
  // without being visible on the form first.
  const NEW_PREFIX = 'new:';
  // What this code last set, so a proposal can be revised while a choice you
  // made yourself is left alone. Without it, picking "Tent" then correcting
  // the name to "Toolbox" would save the item under Camping.
  let proposed = null;

  function proposeCategory() {
    if (categorySelect.value && categorySelect.value !== proposed) return;

    const suggested = categoryForItem(nameInput.value);
    if (!suggested) {
      categorySelect.value = '';
      proposed = null;
      pruneUnusedNewOptions();
      return;
    }

    const already = findByName(state.categories, suggested);
    const value = already ? already.id : NEW_PREFIX + suggested;
    if (!already && ![...categorySelect.options].some((o) => o.value === value)) {
      categorySelect.append(el('option', { value }, `${suggested} (new)`));
    }
    categorySelect.value = value;
    proposed = value;
    pruneUnusedNewOptions();
  }

  /** Drop "(new)" options left behind by earlier proposals. */
  function pruneUnusedNewOptions() {
    for (const option of [...categorySelect.options]) {
      if (option.value.startsWith(NEW_PREFIX) && option.value !== categorySelect.value) {
        option.remove();
      }
    }
  }

  nameInput.addEventListener('input', proposeCategory);

  const locationSelect = el('select', { required: true },
    state.locations.map((l) =>
      el('option', { value: l.id, selected: l.id === startLocation }, pathOf(state.locations, l.id))),
  );

  // ------------------------------------------------------------- photo ---

  const photoBox = el('div', { class: 'photo-box' });

  const fileInput = el('input', {
    type: 'file',
    // No `capture` attribute on purpose. It forces the camera and removes the
    // photo-library option entirely, so an existing photo cannot be chosen.
    // accept="image/*" alone gets a chooser offering both.
    accept: 'image/*',
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        photo = await preparePhoto(file);
        drawPhoto();
        ctx.toast(`Photo ready — ${(photo.size / 1024).toFixed(0)} KB. Save to keep it.`);
      } catch (err) {
        ctx.toast(err.message, 'bad');
      }
    },
  });

  function drawPhoto() {
    clear(photoBox);
    if (photo) {
      photoBox.append(
        el('img', { class: 'photo-preview', src: objectUrl(photo), alt: 'Photo of ' + (nameInput.value || 'this item') }),
        el('div', { class: 'actions' },
          el('label', { class: 'file-btn' }, 'Replace photo', fileInput),
          el('button', {
            type: 'button', class: 'danger',
            onClick: () => { photo = null; drawPhoto(); },
          }, 'Remove photo'),
        ),
      );
    } else {
      photoBox.append(
        el('div', { class: 'actions' }, el('label', { class: 'file-btn' }, 'Take or choose a photo', fileInput)),
      );
    }
  }
  drawPhoto();

  // -------------------------------------------------------------- form ---

  const backTo = () => {
    const target = existing ? existing.locationId : locationId;
    return target ? 'location/' + encodeURIComponent(target) : '';
  };

  const form = el('form', {
    class: 'form',
    onSubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { ctx.toast('Give it a name.', 'bad'); return; }
      if (!locationSelect.value) { ctx.toast('An item has to live somewhere.', 'bad'); return; }
      try {
        let categoryId = categorySelect.value || null;
        if (categoryId?.startsWith(NEW_PREFIX)) {
          const wanted = categoryId.slice(NEW_PREFIX.length);
          // Re-check by name: it may have been created since the form opened.
          const already = findByName(state.categories, wanted);
          categoryId = already ? already.id : (await store.saveCategory({ name: wanted })).id;
        }
        await store.saveItem({
          id: existing?.id,
          name,
          locationId: locationSelect.value,
          categoryId,
          quantity: Math.max(0, Math.trunc(Number(qtyInput.value)) || 0),
          notes: notesInput.value.trim() || null,
          expiryDate: expiryInput.value || null,
          photo,
        });
        await ctx.reload();
        ctx.toast(existing ? 'Saved.' : 'Item added.');
        ctx.go('location/' + encodeURIComponent(locationSelect.value));
      } catch (err) {
        ctx.toast(err.message, 'bad');
      }
    },
  },
    el('h2', {}, existing ? 'Edit item' : 'Add item'),
    el('label', {}, el('span', {}, 'Name'), nameInput, nameList),
    el('label', {}, el('span', {}, 'Location'), locationSelect),
    el('label', {}, el('span', {}, 'Category'), categorySelect,
      el('span', { class: 'field-hint' }, 'Fills in for common items. Change or clear it any time.')),
    el('label', {}, el('span', {}, 'Quantity'), qtyInput),
    el('label', {}, el('span', {}, 'Expires'), expiryInput),
    el('label', {}, el('span', {}, 'Notes'), notesInput),
    el('label', {}, el('span', {}, 'Photo')),
    photoBox,
    el('div', { class: 'actions' },
      el('button', { type: 'submit', class: 'primary' }, existing ? 'Save' : 'Add'),
      el('button', { type: 'button', onClick: () => ctx.go(backTo()) }, 'Cancel'),
      existing && el('button', {
        type: 'button', class: 'danger',
        onClick: async () => {
          if (!confirm(`Delete "${existing.name}"?`)) return;
          // Nothing references an item, so there is no guard to satisfy here.
          await store.deleteItem(existing.id);
          await ctx.reload();
          ctx.toast('Item deleted.');
          ctx.go(backTo());
        },
      }, 'Delete'),
    ),
  );

  queueMicrotask(() => nameInput.focus());
  return form;
}
