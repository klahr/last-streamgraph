import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamScrobbles, LastFmError } from './lastfmApi';
import type { Credentials } from '../types';

const creds: Credentials = { apiKey: 'key', username: 'Tester' };

/** Build a fake getRecentTracks page response. */
function page(
  tracks: object[],
  attr: { page: number; totalPages: number; total: number },
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      recenttracks: {
        track: tracks,
        '@attr': {
          page: String(attr.page),
          totalPages: String(attr.totalPages),
          total: String(attr.total),
        },
      },
    }),
  };
}

const track = (artist: string, name: string, uts: number) => ({
  artist: { '#text': artist },
  album: { '#text': 'Album' },
  name,
  date: { uts: String(uts) },
});

afterEach(() => vi.restoreAllMocks());

describe('streamScrobbles', () => {
  it('paginates across all pages and normalizes tracks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        page([track('A', 'one', 100), track('B', 'two', 99)], {
          page: 1,
          totalPages: 2,
          total: 3,
        }),
      )
      .mockResolvedValueOnce(
        page([track('C', 'three', 50)], { page: 2, totalPages: 2, total: 3 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const batches = [];
    for await (const b of streamScrobbles(creds)) batches.push(b);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const all = batches.flatMap((b) => b.scrobbles);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      user: 'tester', // lowercased
      artist: 'A',
      track: 'one',
      uts: 100,
      album: 'Album',
    });
    expect(all[0].id).toBe('tester::100::A::one');
  });

  it('skips the currently-playing track (no date / nowplaying flag)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      page(
        [
          { artist: { '#text': 'Live' }, name: 'now', '@attr': { nowplaying: 'true' } },
          track('A', 'real', 100),
        ],
        { page: 1, totalPages: 1, total: 1 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const all = [];
    for await (const b of streamScrobbles(creds)) all.push(...b.scrobbles);
    expect(all).toHaveLength(1);
    expect(all[0].track).toBe('real');
  });

  it('passes the `from` watermark as a query parameter', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([], { page: 1, totalPages: 1, total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamScrobbles(creds, { from: 12345 })) { /* drain */ }

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('from=12345');
    expect(url).toContain('user=Tester');
    expect(url).toContain('method=user.getrecenttracks');
  });

  it('passes the `to` watermark for backfill of older history', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([], { page: 1, totalPages: 1, total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    for await (const _ of streamScrobbles(creds, { to: 99999 })) { /* drain */ }

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('to=99999');
    expect(url).not.toContain('from=');
  });

  it('throws a non-retryable LastFmError on API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 10, message: 'Invalid API key' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(async () => {
      for await (const _b of streamScrobbles(creds)) { /* drain */ }
    }).rejects.toThrow(LastFmError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not retried
  });

  it('handles a single-object track (non-array) shape', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        recenttracks: {
          track: track('Solo', 'only', 200),
          '@attr': { page: '1', totalPages: '1', total: '1' },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const all = [];
    for await (const b of streamScrobbles(creds)) all.push(...b.scrobbles);
    expect(all).toHaveLength(1);
    expect(all[0].artist).toBe('Solo');
  });
});
