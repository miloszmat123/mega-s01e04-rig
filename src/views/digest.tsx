import type { NightDigest } from '../digest/types.js';

export function DigestPage({ night, digest }: { night: string; digest: NightDigest }) {
  return (
    <>
      <h1>digest · {night}</h1>
      <p class={digest.badLines > 0 ? 'warn' : 'mute'}>bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">first time</th>
              <th scope="col">last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}</td>
                <td class={row.lastStatus === 'fail' ? 'warn' : undefined}>{row.lastStatus ?? '—'}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstTime}</td>
                <td>{row.lastTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
