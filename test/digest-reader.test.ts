import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const dirs: string[] = [];

async function fixture(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'digest-reader-'));
  dirs.push(dir);
  await writeFile(join(dir, `${night}.jsonl`), contents);
  return dir;
}

function event(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    at: '2026-10-28T23:00:02+01:00',
    job: 'job',
    status: 'ok',
    owner: 'rook',
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readNight', () => {
  it('reads the real night without modifying it', async () => {
    const digest = await readNight('runs', night);
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.find((row) => row.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstTime: '2026-10-29T01:30:00+01:00', lastTime: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows.find((row) => row.job === 'digest/render')?.owner).toBeNull();
  });

  it('returns zero counts for an empty file', async () => {
    expect(await readNight(await fixture(''), night)).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('reads the other real night with event counts rather than job counts', async () => {
    const digest = await readNight('runs', '2026-10-27');
    expect(digest?.rows).toHaveLength(4);
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
  });

  it('counts malformed JSON and shapes without dropping valid rows', async () => {
    const malformed = [
      '{', 'null', '[]', '42', '{}', '',
      event({ at: 'not a time' }), event({ job: '' }), event({ job: 12 }),
      event({ owner: 4 }), event({ owner: undefined }), event({ status: 'pending' }),
      event({ error: null }), event({ error: {} }),
    ];
    const dir = await fixture([...malformed, event({ owner: null })].join('\r\n') + '\r\n');
    expect(await readNight(dir, night)).toMatchObject({
      badLines: malformed.length,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ owner: null, runs: 1, lastError: null }],
    });
  });

  it('uses chronological events, retains offsets and the latest supplied error', async () => {
    const dir = await fixture([
      event({ at: '2026-10-29T03:00:00+02:00', owner: null }),
      event({ at: '2026-10-29T00:30:00+00:00', status: 'fail', error: 'new error' }),
      event({ at: '2026-10-29T02:00:00+02:00', status: 'retry', error: 'old error' }),
    ].join('\n'));
    expect(await readNight(dir, night)).toEqual({
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
        lastError: 'new error', firstTime: '2026-10-29T02:00:00+02:00',
        lastTime: '2026-10-29T03:00:00+02:00',
      }],
    });
  });

  it('breaks timestamp ties in file order and keeps an explicitly empty error', async () => {
    const dir = await fixture([
      event({ status: 'retry', error: 'old', owner: null }),
      event({ status: 'fail', error: '', owner: 'new owner' }),
    ].join('\n'));
    expect((await readNight(dir, night))?.rows[0]).toMatchObject({
      owner: 'new owner', lastStatus: 'fail', lastError: '', runs: 2, retries: 1,
    });
  });

  it('returns null for missing files or directories', async () => {
    const dir = await fixture('');
    expect(await readNight(dir, '2026-10-30')).toBeNull();
    expect(await readNight(join(dir, 'missing'), night)).toBeNull();
  });

  it('rejects invalid night shapes before reading paths outside the runs dir', async () => {
    const dir = await fixture(event());
    const child = join(dir, 'child');
    await mkdir(child);
    for (const invalid of [
      `../${night}`, `/tmp/${night}`, '2026-1-01', '20261028',
      `${night}.jsonl`, `${night}\n`, '',
    ]) {
      expect(await readNight(child, invalid)).toBeNull();
    }
  });

  it('throws unexpected filesystem failures instead of treating them as missing', async () => {
    const dir = await fixture('');
    await rm(join(dir, `${night}.jsonl`));
    await mkdir(join(dir, `${night}.jsonl`));
    await expect(readNight(dir, night)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
