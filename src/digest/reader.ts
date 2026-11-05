import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    typeof value !== 'object' || value === null ||
    !('at' in value) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) ||
    !('job' in value) || typeof value.job !== 'string' || value.job.trim() === '' ||
    !('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail') ||
    !('owner' in value) || (value.owner !== null && typeof value.owner !== 'string') ||
    ('error' in value && typeof value.error !== 'string')
  ) {
    return null;
  }
  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...('error' in value && typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const events: RunEvent[] = [];
  let badLines = 0;
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const event = parseEvent(line);
    if (event) events.push(event);
    else badLines++;
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const rows = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const event of events) {
    counts[event.status]++;
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstTime: event.at,
        lastTime: event.at,
      };
      rows.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastTime = event.at;
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    badLines,
    counts,
  };
};
