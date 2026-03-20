/**
 * router.js
 * Pathname-based SPA router using history.pushState.
 *
 * Routes:
 *   "client"   → /          (default)
 *   "provider" → /provider
 *   "accept"   → /?escrow=<PDA>
 *
 * Entry point files redirect to index.html with a hash bridge
 * (#provider, #client). The router detects the hash, renders the correct
 * view, then replaceState normalizes the URL bar to the clean path.
 *
 * Each route handler receives an AbortSignal — event listeners added with
 * { signal } are automatically removed when the route changes.
 */

const _routes = new Map();
let _ctl = null;

/** Register a route handler. */
export function route(path, fn) {
  _routes.set(path, fn);
}

/** Navigate to a route without a page reload. */
export function navigate(path) {
  history.pushState({}, "", _base() + (path === "client" ? "" : path));
  _dispatch();
}

/** Query params for the current route (reads location.search). */
export function routeParams() {
  const fromSearch = Object.fromEntries(new URLSearchParams(location.search));
  if (fromSearch.escrow) return fromSearch;
  // Fallback: old hash-based accept links (#accept?escrow=...)
  const hash = location.hash.slice(1);
  const qi = hash.indexOf("?");
  return qi >= 0 ? Object.fromEntries(new URLSearchParams(hash.slice(qi + 1))) : {};
}

// ── Internal ──────────────────────────────────────────────────────────────────

/** Base path of the app (supports subdirectory deployments). */
function _base() {
  return location.pathname.replace(/[^/]*$/, "");
}

function _currentPath() {
  // Accept: escrow query param (new) or old hash format
  if (location.search.includes("escrow=") || location.hash.startsWith("#accept")) return "accept";
  // Hash bridge from redirects in provider.html / client.html
  if (location.hash === "#provider") return "provider";
  if (location.hash === "#client")   return "client";
  // Pathname-based (strips base + .html extension)
  const segment = location.pathname.replace(_base(), "").replace(/\.html$/, "");
  // "/" or "" or "client" → client (default); "provider" → provider
  return segment === "provider" ? "provider" : "client";
}

function _dispatch() {
  if (_ctl) _ctl.abort();
  _ctl = new AbortController();

  const path = _currentPath();
  const base = _base();

  // Normalize URL bar to clean path (remove .html, remove hash bridge)
  if (path !== "accept") {
    const target = path === "client" ? base : base + path;
    if (location.pathname !== target || location.hash || location.search) {
      history.replaceState({}, "", target);
    }
  }

  const fn = _routes.get(path) || _routes.get("client");
  if (fn) fn(_ctl.signal);
}

// Intercept <a data-route="..."> clicks — SPA navigation without reload
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-route]");
  if (!el) return;
  e.preventDefault();
  navigate(el.dataset.route);
});

window.addEventListener("popstate",   _dispatch);
window.addEventListener("hashchange", _dispatch);

/** Start the router — dispatches the current URL immediately. */
export function start() {
  _dispatch();
}
