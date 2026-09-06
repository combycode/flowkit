/* Where the built viewer bundle (`viewer.js` + `viewer.css`) is.
 *
 * Two lives, one resolver. In the monorepo it sits in
 * `apps/studio/dist-viewer`, reached by walking up from source. In a PUBLISHED
 * package the source tree is gone; the build copies the bundle in beside the
 * server as `viewer/`, and that is what a stranger's `bunx @combycode/flowkit` finds. The
 * dev path would resolve to nothing there, and the shipped path to nothing in
 * the repo, so both are tried — plus `FLOWKIT_VIEWER` as a manual override.
 *
 * Returns the first directory that actually holds `viewer.js`, or undefined —
 * the caller decides whether a missing canvas is fatal (the studio: no) or an
 * error to report (the export: yes).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Candidate directories, most specific first. */
export function viewerCandidates(from: string): string[] {
  return [
    process.env.FLOWKIT_VIEWER,
    // Published: copied next to the built server file.
    join(from, 'viewer'),
    join(from, '..', 'viewer'),
    // Dev: the studio build inside the monorepo.
    join(from, '..', '..', '..', '..', 'apps', 'studio', 'dist-viewer'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/** The bundle directory in use, or undefined if none holds a build. */
export function findViewerBundle(from: string): string | undefined {
  return viewerCandidates(from).find((dir) => existsSync(join(dir, 'viewer.js')));
}
