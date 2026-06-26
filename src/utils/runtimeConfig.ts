// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Optional host-provided runtime configuration, injected by `/config.js` (a
 * classic script loaded before the app — see `public/config.js`). It lets a
 * deployment bake in a Last.fm API key so visitors don't have to supply their
 * own; they only pick a username (or open a `/username` link).
 *
 * Read synchronously from a global so there's no async flash before the app
 * knows whether a host key is present. The key ships to the browser and is
 * therefore *public* — only ever put a read-only Last.fm API key here, never
 * the shared secret.
 */
declare global {
  interface Window {
    __LSG_CONFIG__?: { apiKey?: string };
  }
}

/** Host-provided Last.fm API key, or '' if the deployment didn't set one. */
export function hostApiKey(): string {
  const key = window.__LSG_CONFIG__?.apiKey;
  return typeof key === 'string' ? key.trim() : '';
}
