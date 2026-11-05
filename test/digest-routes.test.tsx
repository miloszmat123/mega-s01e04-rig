import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest, RunStatus } from '../src/digest/types.js';

const night = '2026-11-05';
const routes = ['/digest', '/api/digest'];
const firstTime = '2026-11-05T01:00:00+05:30';
const lastTime = '2026-11-05T01:03:00+05:30';

function event(job: string, status: RunStatus, owner: string | null, at = firstTime, error?: string) {
  return { at, job, status, owner, ...(error === undefined ? {} : { error }) };
}

// Inspect table semantics without depending on JSX whitespace or attribute order.
function dataRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)]
    .map(([row]) => row)
    .filter((row) => /<td\b/i.test(row));
}

function cells(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)]
    .map(([, value]) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

const warnClass = /\bclass\s*=\s*["'][^"']*\bwarn\b/i;

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
    app = createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    });
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeNight(lines: unknown[], name = night) {
    await writeFile(join(runsDir, `${name}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  it('returns the full JSON contract and the same sorted jobs in the HTML table', async () => {
    await writeNight([
      event('zulu', 'fail', 'Zoe', firstTime, 'disk full'),
      event('alpha', 'retry', null),
      event('beta', 'retry', 'Bea'),
      event('alpha', 'retry', null, '2026-11-05T01:01:00+05:30', 'busy'),
      event('beta', 'retry', 'Bea', '2026-11-05T01:01:00+05:30'),
      event('alpha', 'retry', null, '2026-11-05T01:02:00+05:30'),
      event('beta', 'ok', 'Bea', lastTime),
      event('alpha', 'ok', null, lastTime),
    ]);
    const expected: NightDigest = {
      rows: [
        { job: 'alpha', owner: null, runs: 4, retries: 3, lastStatus: 'ok', lastError: 'busy', firstTime, lastTime },
        { job: 'beta', owner: 'Bea', runs: 3, retries: 2, lastStatus: 'ok', lastError: null, firstTime, lastTime },
        { job: 'zulu', owner: 'Zoe', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full', firstTime, lastTime: firstTime },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 5, fail: 1 },
    };

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toMatch(/application\/json/i);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest).toEqual(expected);

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toMatch(/text\/html/i);
    const rows = dataRows(await htmlResponse.text());
    expect(rows.map((row) => cells(row)[0])).toEqual(digest.rows.map((row) => row.job));
  });

  it('shows null owners as a dash and preserves both original timestamp offsets', async () => {
    await writeNight([
      event('unowned', 'retry', null),
      event('unowned', 'ok', null, lastTime),
    ]);

    const response = await app.request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = dataRows(await response.text());
    expect(rows).toHaveLength(1);
    const values = cells(rows[0]);
    expect(values[1]).toBe('—');
    expect(values.join(' ')).toContain(firstTime);
    expect(values.join(' ')).toContain(lastTime);
  });

  it('marks three retries and failures as warn, but not two retries', async () => {
    await writeNight([
      event('three-retries', 'retry', 'Ada'),
      event('three-retries', 'retry', 'Ada'),
      event('three-retries', 'retry', 'Ada'),
      event('three-retries', 'ok', 'Ada'),
      event('two-retries', 'retry', 'Bea'),
      event('two-retries', 'retry', 'Bea'),
      event('two-retries', 'ok', 'Bea'),
      event('failed', 'fail', 'Zoe', firstTime, 'disk full'),
    ]);

    const response = await app.request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = dataRows(await response.text());
    expect(rows.map((row) => cells(row)[0])).toEqual(['failed', 'three-retries', 'two-retries']);
    expect(rows[0]).toMatch(warnClass);
    expect(rows[1]).toMatch(warnClass);
    expect(rows[2]).not.toMatch(warnClass);
  });

  it.each(routes)('%s returns 404 for a missing night', async (route) => {
    const response = await app.request(`${route}/${night}`);
    expect(response.status).toBe(404);
  });

  it('renders an empty night as nothing ran', async () => {
    await writeNight([]);
    const response = await app.request(`/digest/${night}`);
    expect(response.status).toBe(200);
    expect((await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).toMatch(/nothing ran/i);
  });

  it('returns an empty digest with zero counts for an empty night', async () => {
    await writeNight([]);
    const response = await app.request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips and counts a malformed line while serving valid rows through both routes', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(event('zulu', 'ok', 'Zoe')),
      '{not valid JSON',
      JSON.stringify(event('alpha', 'fail', null, firstTime, 'timeout')),
    ].join('\n'));

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const expected: NightDigest = {
      rows: [
        { job: 'alpha', owner: null, runs: 1, retries: 0, lastStatus: 'fail', lastError: 'timeout', firstTime, lastTime: firstTime },
        { job: 'zulu', owner: 'Zoe', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstTime, lastTime: firstTime },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 0, fail: 1 },
    };
    expect(await jsonResponse.json()).toEqual(expected);
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(dataRows(await htmlResponse.text()).map((row) => cells(row)[0])).toEqual(['alpha', 'zulu']);
  });

  it('escapes job, owner and error text in HTML without changing JSON values', async () => {
    const job = '<script>alert(1)</script>';
    const owner = '<img src=x onerror=alert(2)> & owner';
    const error = '<script>alert(3)</script> & failure';
    await writeNight([event(job, 'fail', owner, firstTime, error)]);

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).not.toMatch(/<(?:script|img)\b/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt; &amp; owner');
    expect(html).toContain('&lt;script&gt;alert(3)&lt;/script&gt; &amp; failure');

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });
  });

  describe.each(routes)('%s night validation', (route) => {
    it.each(['2026-1-05', '20261105', '2026-11-05.extra', 'not-a-night'])(
      'rejects %s even when a matching JSONL file exists',
      async (invalidNight) => {
        await writeNight([event('must-not-leak', 'ok', 'Ada')], invalidNight);
        const response = await app.request(`${route}/${invalidNight}`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('must-not-leak');
      },
    );
  });
});
