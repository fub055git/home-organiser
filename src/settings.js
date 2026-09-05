// Backup and storage. This is the only route data has in or out of the app,
// so it stays a first-class screen rather than a debug corner.

import { el, clear } from './ui.js';
import * as store from './store.js';
import { buildExport, parseImport, serialise, suggestedFilename, downloadText, readFile } from './backup.js';

export async function renderSettings(state, ctx) {
  const p = await store.persistenceStatus();
  const warnings = el('ul', { class: 'warnings' });

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) await doImport(file);
    },
  });

  async function doImport(file) {
    clear(warnings);
    let parsed;
    try {
      parsed = parseImport(await readFile(file));
    } catch (err) {
      ctx.toast(err.message, 'bad');
      return;
    }

    const now = { locations: state.locations.length, categories: state.categories.length, items: state.items.length };
    const ok = confirm(
      'Replace everything currently stored?\n\n' +
      `This file:  ${parsed.locations.length} locations, ${parsed.categories.length} categories, ${parsed.items.length} items\n` +
      `You have:   ${now.locations} locations, ${now.categories} categories, ${now.items} items\n\n` +
      'Import replaces all of it. A backup of what you have now will be downloaded first.'
    );
    if (!ok) { ctx.toast('Import cancelled. Nothing changed.'); return; }

    // Snapshot before overwriting. Skipped when there is nothing to lose, so a
    // first import does not litter Downloads.
    if (now.locations || now.categories || now.items) {
      const snapshot = await buildExport(await store.loadAll());
      downloadText(
        suggestedFilename(snapshot).replace('.json', '-before-import.json'),
        serialise(snapshot),
      );
    }

    await store.replaceAll(parsed);
    await ctx.reload();
    for (const w of parsed.warnings) warnings.append(el('li', {}, w));
    ctx.toast(
      parsed.warnings.length
        ? `Imported, with ${parsed.warnings.length} thing(s) repaired — see below.`
        : 'Imported.',
      parsed.warnings.length ? 'warn' : 'ok',
    );
  }

  return el('div', {},
    el('h2', {}, 'Backup'),
    el('p', { class: 'hint' },
      'Nothing here is stored anywhere but this device. An export is the only copy that survives ' +
      'a cleared browser or a lost phone.'),

    el('div', { class: 'actions' },
      el('button', {
        type: 'button', class: 'primary',
        onClick: async () => {
          const docu = await buildExport(await store.loadAll());
          downloadText(suggestedFilename(docu), serialise(docu));
          ctx.toast(`Exported ${docu.locations.length} locations, ${docu.categories.length} categories, ${docu.items.length} items.`);
        },
      }, 'Export backup'),
      el('label', { class: 'file-btn' }, 'Import backup', fileInput),
    ),
    warnings,

    el('h2', {}, 'Storage'),
    el('ul', { class: 'counts' },
      el('li', {}, el('strong', {}, String(state.locations.length)), 'locations'),
      el('li', {}, el('strong', {}, String(state.categories.length)), 'categories'),
      el('li', {}, el('strong', {}, String(state.items.length)), 'items'),
    ),
    el('p', { class: 'hint' },
      !p.supported
        ? 'Persistent storage: not supported by this browser'
        : `Persistent storage: ${p.persisted ? 'granted' : 'not granted'}` +
          (p.usage !== null ? ` — using ${(p.usage / 1024 / 1024).toFixed(1)} MB` : '')),
    !p.persisted && p.supported && el('p', { class: 'hint' },
      'Browsers can evict storage that is not marked persistent. Installing the app usually grants it.'),

    el('h2', {}, 'Danger zone'),
    el('div', { class: 'actions' },
      el('button', {
        type: 'button', class: 'danger',
        onClick: async () => {
          if (!confirm('Erase every location, category and item on this device?\n\nThere is no server copy. Export first.')) return;
          if (!confirm('Really erase everything?')) return;
          await store.clearAll();
          await ctx.reload();
          ctx.toast('All data erased.', 'warn');
        },
      }, 'Erase everything'),
    ),
  );
}
