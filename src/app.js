// Router and shell.
//
// Hash routing rather than component state: once installed there is no
// address bar, so the OS back gesture is the only way back. It maps to
// browser history, which means without routes one back press quits the app.

import { el, clear, revokeObjectUrls } from './ui.js';
import * as store from './store.js';
import { renderBrowse, renderLocation, renderForm } from './locations.js';
import { renderCategories } from './categories.js';
import { renderItemForm } from './items.js';
import { renderFind } from './find.js';
import { renderSettings } from './settings.js';

const state = { locations: [], categories: [], items: [] };

function route() {
  const [view, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { view: view || 'browse', arg: arg ? decodeURIComponent(arg) : null };
}

const go = (path) => { location.hash = '#/' + path; };

let toastTimer = null;
function toast(message, kind = 'ok') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = 'toast on ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = 'toast ' + kind; }, 3200);
}

const ctx = { go, toast, reload };

async function render() {
  const { view, arg } = route();
  const main = document.getElementById('main');

  // Release the outgoing view's photo URLs. Must happen before the next view
  // is built, or it would revoke the URLs that view just created.
  revokeObjectUrls();

  let node;
  if (view === 'location') node = renderLocation(state, arg, ctx);
  else if (view === 'new') node = renderForm(state, { parentId: arg }, ctx);
  else if (view === 'edit') node = renderForm(state, { id: arg }, ctx);
  else if (view === 'item-new') node = renderItemForm(state, { locationId: arg }, ctx);
  else if (view === 'item') node = renderItemForm(state, { id: arg }, ctx);
  else if (view === 'find') node = renderFind(state, ctx);
  else if (view === 'categories') node = renderCategories(state, ctx);
  else if (view === 'settings') node = await renderSettings(state, ctx);
  else node = renderBrowse(state, ctx);

  clear(main).append(node);
  const tab = ['settings', 'categories', 'find'].includes(view) ? view : 'browse';
  for (const a of document.querySelectorAll('nav.top a')) {
    a.classList.toggle('on', a.dataset.view === tab);
  }
  window.scrollTo(0, 0);
}

async function reload() {
  Object.assign(state, await store.loadAll());
  await render();
}

window.addEventListener('hashchange', render);
reload().catch((err) => {
  document.getElementById('main').append(el('p', { class: 'empty' }, 'Could not open the database: ' + err.message));
});
