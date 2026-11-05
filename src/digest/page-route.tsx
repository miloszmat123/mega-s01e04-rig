import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import { readNight } from './reader.js';

export function registerDigestPage(app: Hono, config: RigConfig): void {
  app.get('/digest/:night', async (c) => {
    const night = c.req.param('night');
    const digest = await readNight(config.runsDir, night);
    if (digest === null) return c.notFound();

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <DigestPage night={night} digest={digest} />
      </Layout>,
    );
  });
}
