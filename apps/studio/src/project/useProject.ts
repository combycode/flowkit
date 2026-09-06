/* Loading a project, and noticing when it changes underneath us.
 *
 * The MCP server owns the file and writes it atomically, so the studio is a
 * reader: it polls for a change and re-reads. That is what makes "ask Claude
 * to change a screen, watch it update" work with no editing UI at all.
 *
 * Polling is a HEAD request against Last-Modified, not a re-fetch — the
 * document is about a megabyte, and pulling that every second and a half to
 * discover nothing changed would be silly. Only a changed timestamp costs a
 * real download.
 *
 * When the desktop host arrives this becomes a subscription to its storage
 * and nothing above this line changes, which is the point of keeping it
 * behind a hook.
 */

import type { ProjectDoc } from '@flowkit/core';
import { useEffect, useState } from 'react';
import { notify } from '../notices/bus';

export type ProjectState =
  | { status: 'loading' }
  | { status: 'ready'; doc: ProjectDoc; revision: number }
  | { status: 'error'; message: string };

export interface UseProjectOptions {
  /** How often to check for an external change. 0 disables polling. */
  pollMs?: number;
}

/** `url` of null means there is nothing to fetch — an exported snapshot
 *  carries its document in the page and never polls anything. */
export function useProject(
  url: string | null,
  { pollMs = 1500 }: UseProjectOptions = {},
): ProjectState {
  const [state, setState] = useState<ProjectState>({ status: 'loading' });

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    let stamp: string | null = null;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      stamp = res.headers.get('last-modified') ?? res.headers.get('etag');
      const doc = (await res.json()) as ProjectDoc;
      if (!cancelled) setState({ status: 'ready', doc, revision: revision++ });
    };

    /** True when the file looks different from what we last read. */
    const changed = async (): Promise<boolean> => {
      // No validator header to compare against — fall back to always reloading
      // would be worse than never, so treat it as unchanged and rely on the
      // user reloading. Vite does send Last-Modified for static files.
      if (stamp === null) return false;
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const next = res.headers.get('last-modified') ?? res.headers.get('etag');
      return next !== null && next !== stamp;
    };

    /* One failed poll means nothing — the next may succeed, and tearing down a
       working canvas over a dropped request is worse than a document a second
       and a half stale. Several in a row mean the server has gone, and THAT
       has to be said: the canvas keeps working, keeps accepting drags that
       silently go nowhere, and looks entirely healthy while doing it. */
    const GIVE_UP_AFTER = 4;
    let failures = 0;

    const tick = async () => {
      try {
        if (await changed()) await load();
        if (failures >= GIVE_UP_AFTER) {
          notify('info', 'Reconnected to the studio server.');
        }
        failures = 0;
      } catch {
        failures += 1;
        if (failures === GIVE_UP_AFTER) {
          notify(
            'error',
            'Lost contact with the studio server.',
            'Changes will not be saved. Restart it with: bun run serve',
          );
        }
      }
      if (!cancelled && pollMs > 0) timer = setTimeout(tick, pollMs);
    };

    load()
      .then(() => {
        if (!cancelled && pollMs > 0) timer = setTimeout(tick, pollMs);
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: String(e) });
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, pollMs]);

  return state;
}
