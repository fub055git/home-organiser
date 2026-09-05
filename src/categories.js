// Category list. Flat, so there is no detail view to drill into -- add,
// rename in place, delete.

import { el, clear } from './ui.js';
import { itemsWithCategory } from './tree.js';
import * as store from './store.js';

function categoryRow(state, cat, ctx) {
  const count = itemsWithCategory(state.items, cat.id).length;
  const row = el('div', { class: 'row cat-row' });

  const showDisplay = () => {
    clear(row).append(
      el('span', { class: 'row-main' }, el('span', { class: 'row-name' }, cat.name)),
      el('span', { class: 'row-meta' }, count ? `${count} item${count === 1 ? '' : 's'}` : 'unused'),
      el('span', { class: 'row-actions' },
        el('button', { type: 'button', onClick: showEdit }, 'Rename'),
        el('button', { type: 'button', class: 'danger', onClick: remove }, 'Delete'),
      ),
    );
  };

  function showEdit() {
    const input = el('input', { type: 'text', value: cat.name, maxLength: 60 });
    const save = async () => {
      try {
        // Renaming has no referential consequence: items point at the id.
        await store.saveCategory({ ...cat, name: input.value });
        await ctx.reload();
        ctx.toast('Renamed.');
      } catch (err) {
        ctx.toast(err.message, 'bad');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') showDisplay();
    });
    clear(row).append(
      input,
      el('span', { class: 'row-actions' },
        el('button', { type: 'button', class: 'primary', onClick: save }, 'Save'),
        el('button', { type: 'button', onClick: showDisplay }, 'Cancel'),
      ),
    );
    input.focus();
    input.select();
  }

  async function remove() {
    const message = count
      ? `Delete "${cat.name}"?\n\nIt is on ${count} item${count === 1 ? '' : 's'}. ` +
        `${count === 1 ? 'That item stays' : 'Those items stay'}, but ${count === 1 ? 'loses' : 'lose'} the category.`
      : `Delete "${cat.name}"?`;
    if (!confirm(message)) return;
    try {
      await store.deleteCategory(cat.id);
      await ctx.reload();
      ctx.toast('Category deleted.');
    } catch (err) {
      ctx.toast(err.message, 'bad');
    }
  }

  showDisplay();
  return row;
}

export function renderCategories(state, ctx) {
  const input = el('input', { type: 'text', placeholder: 'New category', maxLength: 60 });

  const addForm = el('form', {
    class: 'add-row',
    onSubmit: async (e) => {
      e.preventDefault();
      try {
        await store.saveCategory({ name: input.value });
        input.value = '';
        await ctx.reload();
        ctx.toast('Category added.');
      } catch (err) {
        ctx.toast(err.message, 'bad');
      }
    },
  },
    input,
    el('button', { type: 'submit', class: 'primary' }, 'Add'),
  );

  const sorted = [...state.categories].sort((a, b) => a.name.localeCompare(b.name));

  return el('div', {},
    el('div', { class: 'head' }, el('h2', {}, 'Categories')),
    el('p', { class: 'hint' }, 'Optional labels for items. An item can have one, or none.'),
    addForm,
    sorted.length
      ? el('div', { class: 'rows' }, sorted.map((c) => categoryRow(state, c, ctx)))
      : el('p', { class: 'empty' }, 'No categories yet.'),
  );
}
