/* Which port the render sidecar talks on — asked of Chromium, never chosen for
 * it.
 *
 * The obvious design is to find a free port and pass it in. It does not work,
 * and it fails in the worst available way. Binding a socket to check a port is
 * free, closing it, and then spawning a browser that binds it again leaves a
 * gap; under load four processes crossed that gap at once and three of them
 * asked for the same port. Only one browser got it. The other two attached to
 * IT — a stranger's browser, with a stranger's page — and every render after
 * that photographed somebody else's document. Two of eight pictures came back
 * showing the wrong screen entirely, with nothing anywhere reporting an error.
 *
 * So: `--remote-debugging-port=0`, and Chromium writes the port it actually
 * got into `DevToolsActivePort` in its own profile directory. A profile only
 * one process can hold, naming a port only that browser is listening on. There
 * is no window to race through, because nobody picks anything.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Chromium writes two lines: the port, then the browser's websocket path.
 *
 *  Parsed strictly. A half-written file is the normal state for the first few
 *  milliseconds of a launch, and reading a truncated number as a port would
 *  send the connection somewhere arbitrary. */
export function parseActivePort(text: string): number | undefined {
  const [first, second] = text.split('\n');
  if (first === undefined || second === undefined) return undefined; // still being written
  const port = Number(first.trim());
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : undefined;
}

export const ACTIVE_PORT_FILE = 'DevToolsActivePort';

/** The port this profile's browser ended up on, or undefined while it is still
 *  starting. */
export async function activePort(profileDir: string): Promise<number | undefined> {
  try {
    return parseActivePort(await readFile(join(profileDir, ACTIVE_PORT_FILE), 'utf8'));
  } catch {
    return undefined; // not written yet
  }
}

let sequence = 0;

/** A profile directory nothing else can be holding.
 *
 *  Per PROCESS and per sidecar within it: the old code kept one directory for
 *  everyone, so a second browser found the first one's lock, handed over its
 *  arguments and exited silently with status 0.
 *
 *  The pid is in the name so that whatever is left behind can be identified
 *  later — see `sweep`. */
export function profileDir(root: string): string {
  sequence += 1;
  return `${root}-${process.pid}-${sequence}`;
}

/** Is a process with this id still running?
 *
 *  Signal 0 checks without sending anything. EPERM means it exists and belongs
 *  to somebody else, which for this purpose is the same as alive. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Remove scratch profiles left by processes that are gone.
 *
 *  A profile is deleted on the way out, but only if there is a way out: a hard
 *  kill, a crash, or a machine that lost power leaves ten megabytes behind
 *  every time. Nothing else reclaims them, because they live in TEMP under a
 *  name only this file writes.
 *
 *  Directories owned by a LIVE process are left alone — one of them is
 *  probably the studio's, sitting idle between renders. */
export async function sweep(root: string): Promise<number> {
  const { readdir, rm } = await import('node:fs/promises');
  const { dirname, basename } = await import('node:path');

  const parent = dirname(root);
  const prefix = `${basename(root)}-`;

  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    // `<root>-<pid>-<n>`, and nothing else. A name that does not parse is not
    // one of ours, whatever it starts with.
    const parts = entry.slice(prefix.length).split('-');
    const pid = Number(parts[0]);
    if (parts.length !== 2 || !Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid || alive(pid)) continue;

    await rm(`${parent}/${entry}`, { recursive: true, force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
}
