import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { registerDigestJson } from '../src/digest/json-route.js';
import * as reader from '../src/digest/reader.js';
import type { NightDigest } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '', beatEverySeconds: 60, runsDir: 'test-runs' };

afterEach(() => vi.restoreAllMocks());

it('returns the shared digest unchanged and delegates night selection to the reader', async () => {
  const digest: NightDigest = {
    rows: [{
      job: 'alpha',
      owner: null,
      runs: 2,
      retries: 1,
      lastStatus: 'ok',
      lastError: null,
      firstTime: '2026-10-28T01:00:00+02:00',
      lastTime: '2026-10-28T02:00:00+02:00',
    }],
    badLines: 1,
    counts: { ok: 1, retry: 1, fail: 0 },
  };
  const readNight = vi.spyOn(reader, 'readNight').mockResolvedValue(digest);
  const app = new Hono();
  registerDigestJson(app, config);

  const response = await app.request('/api/digest/2026-10-28');

  expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, '2026-10-28');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual(digest);
});

it.each(['2026-10-29', 'invalid'])('returns 404 when the reader returns null for %s', async (night) => {
  vi.spyOn(reader, 'readNight').mockResolvedValue(null);
  const app = new Hono();
  registerDigestJson(app, config);

  expect((await app.request(`/api/digest/${night}`)).status).toBe(404);
});
