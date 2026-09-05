// Service worker registration. Separate from app.js because app.js is Stage 1
// scaffolding that Stage 3 deletes, and this needs to outlive it.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Resolved relative to this module, so the app survives being served from
    // a subpath. sw.js sits at the root, which is what gives it whole-app scope.
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url))
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
