// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Shareable-link support, in two distinct flavours:
 *
 * - **A live link**: the Last.fm username lives in the URL path (e.g.
 *   `/klarre908`), so it encodes *whose* history to show, and the viewer needs
 *   their own API key to fetch it. The key itself is never placed in the URL —
 *   it's a per-viewer secret read from localStorage.
 * - **A snapshot link**: {@link SHARE_PATH} plus a fragment holding one view's
 *   own data (see `shareSnapshot.ts`). It carries no username, needs no key,
 *   and fetches nothing.
 *
 * Keeping them apart matters: a live link hands over a whole listening history
 * to browse, a snapshot hands over one chart. Sharing a chart must not quietly
 * do the former.
 */

// Last.fm usernames are letters/digits/`_`/`-`; cap length to keep stray paths
// (favicon probes, deep links from other tools) from being treated as a user.
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,30}$/;

/** Route that serves a static snapshot rather than the app. */
export const SHARE_PATH = '/s';

/** True when the current URL is a snapshot link. */
export function isSharePath(): boolean {
  return (
    '/' + window.location.pathname.replace(/^\/+|\/+$/g, '') === SHARE_PATH
  );
}

/** The raw encoded snapshot from the URL fragment, or '' when there is none. */
export function snapshotFragment(): string {
  return window.location.hash.replace(/^#/, '');
}

/** Absolute URL for an encoded snapshot fragment. */
export function shareUrlFor(fragment: string): string {
  return `${window.location.origin}${SHARE_PATH}#${fragment}`;
}

/** Read a username from the current URL path, or '' if absent/invalid. */
export function usernameFromPath(): string {
  // `/s` is a valid-looking username, so the snapshot route has to be excluded
  // explicitly or a snapshot link would also try to load a user called "s".
  if (isSharePath()) return '';
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
