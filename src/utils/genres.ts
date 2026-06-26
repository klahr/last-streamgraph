// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Derive a single genre label from an artist's Last.fm top tags.
 *
 * Last.fm tags are crowd-sourced and noisy — they mix real genres with
 * descriptors ("female vocalists"), decades ("80s"), nationalities ("swedish"),
 * and junk ("seen live"). We take the most-voted tag that isn't obvious
 * non-genre noise. It's a heuristic, not perfect, but the #1 musical tag is a
 * good genre for the vast majority of artists.
 */
export const UNKNOWN_GENRE = 'Unknown';

/** Tags that are never genres. Compared lowercased. */
const BLOCKLIST = new Set([
  'seen live',
  'favorites',
  'favourites',
  'favorite',
  'favourite',
  'favorite songs',
  'my favorites',
  'spotify',
  'albums i own',
  'vinyl',
  'love',
  'loved',
  'beautiful',
  'awesome',
  'epic',
  'cool',
  'good',
  'great',
  'amazing',
  'best',
  'masterpiece',
  'female vocalists',
  'male vocalists',
  'female vocalist',
  'male vocalist',
  'female fronted',
  'male fronted',
  'cover',
  'covers',
  'live',
  'instrumental',
  'soundtracks', // keep singular "soundtrack" as a genre; plural tag is a list
  'my music',
  'check out',
  'want to see live',
  'under 2000 listeners',
]);

/** Nationality / language tags that aren't genres. */
const COUNTRY = new Set([
  'american',
  'british',
  'english',
  'swedish',
  'norwegian',
  'finnish',
  'german',
  'french',
  'italian',
  'japanese',
  'canadian',
  'australian',
  'russian',
  'polish',
  'dutch',
  'danish',
  'usa',
  'uk',
]);

/** Decade-ish tags: "80s", "1990s", "00s", "2010", etc. */
const DECADE_RE = /^(19|20)?\d0?'?s?$/;

const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Pick the best genre from an ordered (most-voted first) tag list. */
export function pickGenre(tags: readonly string[]): string {
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (BLOCKLIST.has(t)) continue;
    if (COUNTRY.has(t)) continue;
    if (DECADE_RE.test(t)) continue;
    return titleCase(raw.trim());
  }
  return UNKNOWN_GENRE;
}
