// Find: search items by name or notes, filter by category.
//
// The controls and the results list are separate nodes on purpose. Rebuilding
// the whole view on each keystroke would destroy and recreate the input,
// losing focus and cursor position after a single character -- so typing
// rebuilds only the results.

import { el, clear, objectUrl } from './ui.js';
import { searchItems, pathOf } from './tree.js';

export function renderFind(state, ctx) {
  const queryInput = el('input', {
    type: 'search',
    placeholder: 'Search name or notes',
    autocomplete: 'off',
    'aria-label': 'Search items',
  });

  const categorySelect = el('select', { 'aria-label': 'Filter by category' },
    el('option', { value: 'any' }, 'Any category'),
    el('option', { value: 'none' }, 'Uncategorised'),
    [...state.categories].sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => el('option', { value: c.id }, c.name)),
  );

  const summary = el('p', { class: 'hint' });
  const results = el('div', { class: 'rows' });

  // One object URL per item for the life of this view, rather than a fresh
  // one on every keystroke. The router revokes them all on navigation.
  const thumbUrls = new Map();
  const thumbFor = (it) => {
    if (!thumbUrls.has(it.id)) thumbUrls.set(it.id, objectUrl(it.photo));
    return thumbUrls.get(it.id);
  };

  function resultRow(it) {
    const cat = it.categoryId ? state.categories.find((c) => c.id === it.categoryId) : null;
    const meta = [];
    if (it.quantity !== 1) meta.push('×' + it.quantity);
    if (it.expiryDate) meta.push('expires ' + it.expiryDate);

    return el('button', {
      class: 'row result-row',
      type: 'button',
      onClick: () => ctx.go('item/' + encodeURIComponent(it.id)),
    },
      it.photo
        ? el('img', { class: 'thumb', src: thumbFor(it), alt: '' })
        : el('span', { class: 'thumb thumb-empty', 'aria-hidden': 'true' }),
      el('span', { class: 'result-main' },
        el('span', { class: 'result-top' },
          el('span', { class: 'row-name' }, it.name),
          cat ? el('span', { class: 'chip' }, cat.name) : null,
          meta.length ? el('span', { class: 'row-meta' }, meta.join(' · ')) : null,
        ),
        el('span', { class: 'result-path' }, pathOf(state.locations, it.locationId) || 'Location missing'),
      ),
    );
  }

  function update() {
    const choice = categorySelect.value;
    const categoryId = choice === 'any' ? undefined : choice === 'none' ? null : choice;
    const found = searchItems(state.items, { query: queryInput.value, categoryId })
      .sort((a, b) => a.name.localeCompare(b.name));

    const total = state.items.length;
    summary.textContent = found.length === total
      ? `${total} item${total === 1 ? '' : 's'}`
      : `${found.length} of ${total} item${total === 1 ? '' : 's'}`;

    clear(results);
    if (found.length) results.append(...found.map(resultRow));
    else results.append(el('p', { class: 'empty' }, 'Nothing matches.'));
  }

  queryInput.addEventListener('input', update);
  categorySelect.addEventListener('change', update);
  update();

  queueMicrotask(() => queryInput.focus());

  return el('div', {},
    el('div', { class: 'head' }, el('h2', {}, 'Find')),
    el('div', { class: 'find-controls' }, queryInput, categorySelect),
    summary,
    results,
  );
}
