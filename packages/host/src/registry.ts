/* Where projects are, when they are not in the default folder.
 *
 * A design belongs next to the thing it describes: in the repo, beside the
 * code, committed with it. So a project has to be openable from any path —
 * `./design/app.json` — not only from one blessed directory.
 *
 * That leaves the problem of finding it again. Scanning the disk is not an
 * option, so an opened project is REMEMBERED: id, path, and when it was last
 * touched. The registry is a cache of locations, never of content — the
 * document at that path is always the truth, and an entry pointing at a file
 * that has moved is dropped rather than repaired.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { exists, readJson } from './fsx.ts';
import { workspaceDir } from './paths.ts';

export interface KnownProject {
  id: string;
  path: string;
  name: string;
  lastOpened: string;
}

/** The registry lives INSIDE the workspace it belongs to.
 *
 *  At application level it was global, so a server pointed at one workspace
 *  still listed projects remembered from another — and a test with its own
 *  temporary workspace inherited whatever was on the real machine. A workspace
 *  should be self-contained: its own projects, plus its own memory of the
 *  external ones opened while using it. */
const registryPath = (): string => join(workspaceDir(), '.known-projects.json');

/** Every remembered project whose file is still there.
 *
 *  A stale entry is dropped silently: a project someone moved or deleted is
 *  not an error to report every time the list is asked for. */
export async function knownProjects(): Promise<KnownProject[]> {
  const path = registryPath();
  if (!(await exists(path))) return [];
  const entries = await readJson<KnownProject[]>(path).catch(() => []);
  const alive: KnownProject[] = [];
  for (const entry of entries) {
    if (await exists(entry.path)) alive.push(entry);
  }
  return alive.sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
}

/** Record a project's location, or refresh it. Keyed by PATH, not id: the
 *  same file opened twice is one project, and two projects in different
 *  folders may legitimately share an id. */
export async function remember(entry: Omit<KnownProject, 'lastOpened'>): Promise<void> {
  const full = resolve(entry.path);
  const others = (await knownProjects()).filter((k) => resolve(k.path) !== full);
  const next: KnownProject[] = [
    { ...entry, path: full, lastOpened: new Date().toISOString() },
    ...others,
  ].slice(0, 50); // a recents list, not a database

  const path = registryPath();
  await mkdir(dirname(path), { recursive: true });
  // Best-effort: failing to remember where a project is must never fail the
  // command that opened it.
  await writeFile(path, JSON.stringify(next, null, 2), 'utf8').catch(() => undefined);
}

export async function forget(id: string): Promise<void> {
  const kept = (await knownProjects()).filter((k) => k.id !== id);
  await writeFile(registryPath(), JSON.stringify(kept, null, 2), 'utf8').catch(() => undefined);
}

/** The path for a project id, if one is remembered. */
export async function pathOfKnown(id: string): Promise<string | undefined> {
  return (await knownProjects()).find((k) => k.id === id)?.path;
}

/** An id derived from a file path, for a project opened from outside the
 *  default folder. The folder name is usually more meaningful than the file
 *  name — `myapp/design.json` is better identified as `myapp` than `design`. */
export function idFromPath(path: string): string {
  const file = path.replace(/\\/g, '/').replace(/\.json$/i, '');
  const parts = file.split('/').filter(Boolean);
  const base = parts.at(-1) ?? 'project';
  const parent = parts.at(-2);
  const stem = /^(design|project|ui|app)$/i.test(base) && parent ? parent : base;
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'project'
  );
}
