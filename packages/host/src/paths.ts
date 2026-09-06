/* Where projects live.
 *
 * Under `apps/studio/public/` they were served by the dev server for free,
 * which was convenient and wrong: a user's work does not belong inside the
 * application's own source tree, and a Tauri build has no `public/` to write
 * to at all.
 *
 * Resolution order, most specific first:
 *   1. an explicit path (a --workspace flag)
 *   2. FLOWKIT_HOME, for tests and for running several workspaces
 *   3. the platform's application-data directory
 *
 * The platform directory is what the desktop app will use unchanged, so the
 * dev setup and the shipped one differ by nothing but a flag.
 */

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

/** The canvas port the server starts from unless told otherwise. */
export const DEFAULT_PORT = 5190;

const APP = 'Flowkit';
/** What this was called before the tool was named. A machine that already has
 *  work under the old directory keeps using it: a rename is not a reason to
 *  lose somebody's projects, and the registry of remembered projects lives in
 *  there too. */
const WAS = 'DesignFlow';

function underHome(app: string): string {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      // Roaming, not Local: a project is the user's work, and follows them
      // onto another machine on a domain profile.
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), app);
    case 'darwin':
      return join(home, 'Library', 'Application Support', app);
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), app.toLowerCase());
  }
}

/** The application-data directory for this platform. */
export function appDataDir(): string {
  const current = underHome(APP);
  if (existsSync(current)) return current;
  const previous = underHome(WAS);
  return existsSync(previous) ? previous : current;
}

/** The folder holding project documents. */
export function workspaceDir(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.FLOWKIT_HOME ?? process.env.DESIGN_FLOW_HOME;
  if (fromEnv) return fromEnv;
  return join(appDataDir(), 'projects');
}

/** The canvas port to start from. A `--port` flag wins (passed in as
 *  `explicit`); then FLOWKIT_PORT, for a machine that always wants another
 *  number; then the built-in default. The server still walks upward from here
 *  if the port is taken, so this is a starting point, not a demand. */
export function defaultPort(explicit?: number | string): number {
  const pick = explicit ?? process.env.FLOWKIT_PORT;
  const n = typeof pick === 'string' ? Number.parseInt(pick, 10) : pick;
  return n !== undefined && Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/** Where an export lands by default: a folder beside the project file.
 *
 *  A design in a repo belongs with the code it describes, and so do the images
 *  and pages generated from it — someone opening that repo should find the
 *  screens next to the project, not in an application-data folder they have no
 *  reason to know about.
 *
 *  It follows the project, so a project that lives in the default folder still
 *  exports into the default folder. Worth adding `exports/` to a .gitignore
 *  if the images are large and regenerable, which they are. */
export function exportDir(projectFile?: string): string {
  if (projectFile) return join(dirname(projectFile), 'exports');
  return join(appDataDir(), 'exports');
}

export const projectPath = (dir: string, id: string): string => join(dir, `${id}.json`);
