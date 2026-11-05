export type RunStatus = 'ok' | 'retry' | 'fail'

export interface DigestRow {
  job: string
  /** Owner of the latest event, including an explicit null. */
  owner: string | null
  /** All valid events for this job. */
  runs: number
  retries: number
  lastStatus: RunStatus
  /** Latest supplied error; a later event without an error does not clear it. */
  lastError: string | null
  /** Chronological bounds, preserving the original timestamp offsets. */
  firstTime: string
  lastTime: string
}

export interface NightDigest {
  /** Sorted by job. Equal event timestamps retain file order. */
  rows: DigestRow[]
  badLines: number
  /** Counts of all valid events, not final job statuses. */
  counts: Record<RunStatus, number>
}

/** Missing file or invalid YYYY-MM-DD night returns null; other I/O errors throw. */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest | null>
