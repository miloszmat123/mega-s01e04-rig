import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { readStatus } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

async function renderBoard(runsDir = config.runsDir) {
  const status = await readStatus({ ...config, runsDir });
  const app = new Hono();
  app.get('/', (c) => c.html(<StatusBoard status={status} />));
  const response = await app.request('/');
  expect(response.status).toBe(200);
  return { status, html: await response.text() };
}

describe('nightly digest board links', () => {
  it('links nights newest first and shows event counts, preserving board details', async () => {
    const { status, html } = await renderBoard();
    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nightCounts).toEqual({
      '2026-10-28': { ok: 10, retry: 4, fail: 1 },
      '2026-10-27': { ok: 7, retry: 0, fail: 0 },
    });
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok 10 / retry 4 / fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok 7 / retry 0 / fail 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).toContain('<h1>status</h1>');
    expect(html).toContain(config.adapter);
    expect(html).toContain(config.installed);
    expect(html).toContain('<th>last beat</th>');
    expect(html).toContain('<h2>nights on disk</h2>');
  });

  it('preserves the empty board message', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-board-'));
    try {
      const { status, html } = await renderBoard(runsDir);
      expect(status.nights).toEqual([]);
      expect(status.nightCounts).toEqual({});
      expect(html).toContain('nothing in runs/');
    } finally {
      await rm(runsDir, { recursive: true, force: true });
    }
  });
});
