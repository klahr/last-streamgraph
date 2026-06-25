# Last Streamgraph

An interactive, flowing **streamgraph** of your Last.fm listening history, built
with React + Vite + TypeScript + D3. Scrobbles are fetched incrementally from
the Last.fm API and cached in IndexedDB, so subsequent loads are instant and
only new plays are synced.

![Absolute / monthly streamgraph](docs/preview.png)

## Features

- **Organic streamgraph** — `d3.stack` with a wiggle offset and `curveBasis`
  smoothing for rippling, centered waves.
- **Absolute vs. relative modes** — total thickness encodes scrobble counts, or
  normalize every interval to fill 100 % height (`stackOffsetExpand`).
- **Weekly (ISO) or monthly buckets**, all computed in UTC for determinism.
- **Top-N _per interval_** — an artist becomes a stream if it ranked in the top
  N of *any* single bucket (the union of per-interval leaders), so one-month
  wonders aren't hidden by all-time favourites. The rest fold into **Others**
  or are discarded.
- **Incremental sync** — the newest cached timestamp is the watermark; only
  plays after it are fetched. Pages persist as they arrive with a live progress
  bar.
- **Off-main-thread processing** — the aggregation pipeline runs in a Web Worker
  so toggling config or resizing never blocks rendering, even with hundreds of
  artists over years of history.
- **Responsive** via `ResizeObserver`, with hover dimming + tooltip and
  swappable D3 color palettes.

## Getting started

```bash
npm install
npm run dev
```

Open the app, then in the left panel enter:

1. A **Last.fm API key** — create one at
   <https://www.last.fm/api/account/create> (only the key is needed; no secret,
   since `user.getRecentTracks` is unauthenticated).
2. Your **Last.fm username**.

The first sync fetches your full history (cached locally in your browser);
later visits only pull new scrobbles. Use **Full** to wipe the cache and
re-fetch from scratch.

## Scripts

| Script              | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Vite dev server                          |
| `npm run build`     | Typecheck (`tsc -b`) + production build  |
| `npm run preview`   | Serve the production build               |
| `npm test`          | Run the Vitest unit suite                |
| `npm run typecheck` | Type-only check                          |

## Architecture

```
src/
  services/
    indexedDb.ts        # idb-backed scrobble store (composite key, [user,uts] index)
    lastfmApi.ts        # rate-limited, paginated streamScrobbles() generator
  hooks/
    useScrobbleData.ts  # hydrate from cache + incremental sync + progress
    useProcessedData.ts # debounced worker-driven processing
    useResizeObserver.ts
    useLocalStorage.ts
  workers/
    dataProcessor.worker.ts  # runs the pipeline off the main thread
    processClient.ts         # promise wrapper; drops stale requests
  utils/
    dataProcessor.ts    # pure: bucketing, per-interval top-N union, dense matrix
    colors.ts           # palette → key→color map
  components/
    Streamgraph.tsx     # imperative D3 render (transitions) + React tooltip
    ControlPanel.tsx    # configuration sidebar
  App.tsx               # state + layout
```

### Data flow

```
Last.fm API ──stream pages──▶ IndexedDB ──hydrate──▶ React state
                                               │
                              config ──▶ Web Worker (processScrobbles)
                                               │
                                       ProcessedData ──▶ Streamgraph (D3)
```

## Notes

- The Last.fm client requests `limit=1000` per page (undocumented but accepted),
  ~5× fewer requests than the documented max of 200, and rate-limits to ~4 req/s.
- The "now playing" track (no timestamp) is skipped — it isn't a scrobble yet.
- Everything is client-side; your API key and data never leave the browser.
