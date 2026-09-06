// Minimal DOM builder.
//
// The point is not brevity, it is that text can only get in through
// createTextNode. There is no innerHTML anywhere in this app, so escaping
// user data is not a rule anyone has to remember -- a location named
// "<spare> parts" renders as typed because it cannot do anything else.

// Properties that exist on the element but are readonly, so assigning them
// does nothing at all. `input.list` returns the linked <datalist> element and
// cannot be set -- it only binds via the attribute. Silent failure otherwise.
const ATTRIBUTE_ONLY = new Set(['list']);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!ATTRIBUTE_ONLY.has(key) && key in node) node[key] = value;
    else node.setAttribute(key, value);
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// A Blob is not a URL. createObjectURL makes one, and the browser holds that
// reference until it is revoked -- so a photo shown and forgotten leaks for
// the life of the page. Every URL is registered here and the router revokes
// the lot before it swaps views, which makes the lifecycle structural rather
// than something each view has to remember.

const liveUrls = new Set();

export function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  liveUrls.add(url);
  return url;
}

export function revokeObjectUrls() {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}
