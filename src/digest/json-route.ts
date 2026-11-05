import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

export function registerDigestJson(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));
    return digest === null ? c.notFound() : c.json(digest);
  });
}
