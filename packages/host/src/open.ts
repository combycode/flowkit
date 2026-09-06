/* Opening a page in whatever browser the person actually uses.
 *
 * Deliberately small, and deliberately not automatic. The canvas comes up with
 * the agent and its URL is reported; a window appearing on somebody's screen
 * because a tool ran is a different thing, and only ever happens when they ask
 * for it.
 */

import { spawn } from 'node:child_process';

/** The command for a platform, as argv. Separated from running it so the
 *  quoting can be tested without launching anything. */
export function openCommand(os: NodeJS.Platform, url: string): [string, string[]] {
  switch (os) {
    /* `start` is a shell builtin, not a program, so it needs cmd — and its
     * FIRST quoted argument is the window title, not the URL. Omitting the
     * empty title makes `start "http://…"` open a console titled with the
     * address instead of a browser, which is a famously baffling ten minutes. */
    case 'win32':
      return ['cmd', ['/c', 'start', '', url]];
    case 'darwin':
      return ['open', [url]];
    default:
      return ['xdg-open', [url]];
  }
}

/** Hand a URL to the desktop. Resolves once it has been handed over, not once
 *  anything has loaded — the browser is somebody else's process and its
 *  lifetime is none of ours. */
export function openInBrowser(url: string, os: NodeJS.Platform = process.platform): Promise<void> {
  const [command, args] = openCommand(os, url);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      // Let it outlive us: a server shutting down should not close a window
      // the person is reading.
      child.unref();
      resolve();
    });
  });
}
