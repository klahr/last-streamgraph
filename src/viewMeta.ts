// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tab labels and one-line summaries for every view. Lives outside `App` so the
 * snapshot poster can title a shared chart with exactly the words the app uses.
 */
import type { View } from './types';

export const VIEWS: { id: View; label: string }[] = [
  { id: 'streamgraph', label: 'Streamgraph' },
  { id: 'forecast', label: '🔮 Forecast' },
  { id: 'obsessions', label: 'Obsessions' },
  { id: 'novelty', label: 'New vs. old' },
  { id: 'tenure', label: 'Tenure' },
  { id: 'retention', label: 'Retention' },
  { id: 'yoy', label: 'Year on year' },
  { id: 'punchcard', label: 'Punchcard' },
  { id: 'genrehours', label: 'Genre clock' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'albumdepth', label: 'Albums' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'rankbump', label: 'Rank' },
  { id: 'sunburst', label: 'Breakdown' },
  { id: 'network', label: 'Network' },
];

/** Tab label for a view, falling back to the id for anything unlisted. */
export const labelFor = (view: View): string =>
  VIEWS.find((v) => v.id === view)?.label ?? view;

/**
 * The tab label without its decoration — "🔮 Forecast" reads fine as a tab but
 * not set in 60px on a poster, where the emoji lands mid-sentence.
 */
export const plainLabelFor = (view: View): string =>
  labelFor(view).replace(/^[^\p{L}\p{N}]+/u, '');

/**
 * Default title offered when sharing. Prefilled into an editable field rather
 * than stamped on the snapshot: the username is the sharer's to disclose, so it
 * should be sitting in front of them, deletable, before the link exists.
 */
export const shareTitleFor = (view: View, username: string): string => {
  const name = username.trim();
  return name ? `${name}'s ${plainLabelFor(view)}` : plainLabelFor(view);
};

/** One-line, user-facing summary of each view. Mirrors each view's doc comment
 * so the in-app copy and the code documentation can't drift. */
export const VIEW_DESCRIPTIONS: Record<View, string> = {
  streamgraph: 'Listening volume over time as flowing, stacked streams — one per top artist/genre/album.',
  forecast: 'A naive extrapolation of your next 6 months per top series — damped trend + seasonality, graded surging to dead. For fun, not prophecy.',
  punchcard: 'When you listen by weekday × hour (your local time). Brighter cells = more plays in that slot.',
  calendar: 'A GitHub-style daily heatmap of plays, one cell per day, weeks as columns.',
  seasonal: 'Which artists/genres/albums belong to a time of year — ranked by how tightly their plays cluster in the calendar and how many years agree. Each month is measured against your own listening that month, so month length and a mid-year account start cancel out. Filter by name, peak season, or play count.',
  discovery: 'When each artist first entered your library, over a cumulative distinct-artists curve.',
  rankbump: 'How the top artists\' ranking shifts across time buckets — rank 1 at the top, lines break on drop-out.',
  sunburst: 'A two-ring breakdown, one level apart: genres → their artists, artists → their albums, or albums → their tracks, following Group-by.',
  network: 'Artists you play on the same days pull together in a force-directed graph; edges = shared listening days.',
  obsessions: 'The tracks you played into the ground — ranked by burst (peak plays in any 7 days), not by total.',
  novelty: 'Exploring or comforting yourself? Plays split into brand-new artists vs. ones you already knew, per bucket.',
  tenure: 'Lifers vs. flings: how long each artist stayed, from their first play to their last.',
  genrehours: 'Each genre\'s own daily shape — rows normalized and sorted from morning listening to late-night.',
  albumdepth: 'Albums by breadth (distinct tracks played) × depth (total plays). Above the dashed line = repeat listening.',
  sessions: 'Listening blocks: consecutive plays with no long gap, so you can see how long a typical sitting runs.',
  yoy: 'Cumulative plays per calendar year on one day-of-year axis — which year was heavy, and whether you\'re ahead of last year.',
  retention: 'How fast each year\'s discoveries faded. One bar per discovery year showing its half-life — the age by which half that batch\'s plays had happened — beside the decay shape behind it. Cohorts too young to judge are marked, not guessed. Reads all history.',
};
