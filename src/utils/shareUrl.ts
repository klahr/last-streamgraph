/**
 * Shareable-link support: the Last.fm username lives in the URL path
 * (e.g. `/klarre908`) so a link encodes *whose* history to show. The API key is
 * never placed in the URL — it's a per-viewer secret read from localStorage, so
 * a shared link only works for someone who has their own key entered.
 */

// Last.fm usernames are letters/digits/`_`/`-`; cap length to keep stray paths
// (favicon probes, deep links from other tools) from being treated as a user.
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,30}$/;

/** Read a username from the current URL path, or '' if absent/invalid. */
export function usernameFromPath(): string {
  const seg = decodeURIComponent(
    window.location.pathname.replace(/^\/+|\/+$/g, ''),
  );
  return USERNAME_RE.test(seg) ? seg : '';
}

/**
 * Reflect the active username into the URL path without a reload, so the
 * address bar is always a shareable link. Preserves any query/hash.
 */
export function syncUsernameToPath(username: string): void {
  const path = username ? `/${encodeURIComponent(username)}` : '/';
  if (window.location.pathname === path) return;
  window.history.replaceState(
    null,
    '',
    path + window.location.search + window.location.hash,
  );
}

/** Absolute shareable link for a username (origin + path). */
export function shareLink(username: string): string {
  return `${window.location.origin}/${encodeURIComponent(username)}`;
}
