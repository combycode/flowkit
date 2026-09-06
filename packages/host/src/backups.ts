/* Copies of the document from before.
 *
 * Undo covers the mistake you notice now. It does not cover the one you
 * notice tomorrow, after the log has rolled past it — or a command that was
 * accepted, valid, and simply wrong. A project is ONE file; without copies,
 * "the agent rewrote that screen and I liked the old one" has no answer.
 *
 * Kept beside the application rather than beside the project, for the same
 * reason as the history: the design is committed, and twenty megabytes of
 * near-identical JSON is not something to commit alongside it.
 *
 * THROTTLED, deliberately. A copy per command would write a megabyte every
 * time a screen is dragged. A copy every few minutes, plus one before the
 * first change of a session, is what actually gets someone back to a state
 * they remember.
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { exists } from './fsx';
import { appDataDir } from './paths';

export interface Backup {
  /** ISO 8601, and the file's own name. */
  at: string;
  path: string;
  bytes: number;
}

export interface BackupOptions {
  /** How many to keep. */
  keep?: number;
  /** Do not take another one within this long of the newest. */
  everyMs?: number;
  /** Take one regardless of when the last was — the first change of a
   *  session, so "what it looked like when I sat down" always survives. */
  force?: boolean;
}

const DEFAULT_KEEP = 12;
const DEFAULT_EVERY_MS = 10 * 60 * 1000;

/** Copy the project as it stands now. Returns the copy, or undefined when one
 *  was taken recently enough that this would be noise. */
export async function backup(
  project: string,
  options: BackupOptions = {},
): Promise<Backup | undefined> {
  if (!(await exists(project))) return undefined;

  const keep = options.keep ?? DEFAULT_KEEP;
  const everyMs = options.everyMs ?? DEFAULT_EVERY_MS;
  const existing = await backups(project);
  const newest = existing[0];

  if (!options.force && newest && Date.now() - Date.parse(newest.at) < everyMs) {
    return undefined;
  }

  const dir = dirFor(project);
  await mkdir(dir, { recursive: true });

  // A backup is named by its ISO time to the millisecond. Two forced backups in
  // the same millisecond — ordinary on a fast machine, which is why this only
  // ever showed on Linux CI — would otherwise share a name and the second would
  // overwrite the first. Bump the timestamp until the name is free: the copies
  // stay distinct, still sort correctly, and each carries a valid time.
  let when = Date.now();
  let at = new Date(when).toISOString();
  let path = join(dir, `${at.replace(/[:.]/g, '-')}.json`);
  while (await exists(path)) {
    at = new Date(++when).toISOString();
    path = join(dir, `${at.replace(/[:.]/g, '-')}.json`);
  }

  // A copy, not a re-serialisation: whatever is on disk is what gets restored,
  // byte for byte, including anything this version of the code would not have
  // written itself.
  await copyFile(project, path);

  const info = await stat(path);
  await prune(dir, keep);
  return { at, path, bytes: info.size };
}

/** Newest first. */
export async function backups(project: string): Promise<Backup[]> {
  const dir = dirFor(project);
  const names = await readdir(dir).catch(() => [] as string[]);

  const found = await Promise.all(
    names
      .filter((n) => n.endsWith('.json'))
      .map(async (name) => {
        const path = join(dir, name);
        const info = await stat(path).catch(() => undefined);
        return info ? { at: atOf(name), path, bytes: info.size } : undefined;
      }),
  );

  return found.filter((b): b is Backup => b !== undefined).sort((a, b) => b.at.localeCompare(a.at));
}

/** The one taken at this time, or the newest if no time is given. */
export async function findBackup(project: string, at?: string): Promise<Backup | undefined> {
  const all = await backups(project);
  if (at === undefined) return all[0];
  return all.find((b) => b.at === at || b.path.endsWith(`${at.replace(/[:.]/g, '-')}.json`));
}

async function prune(dir: string, keep: number): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith('.json'))
    .sort()
    .reverse();

  for (const name of names.slice(keep)) {
    await rm(join(dir, name), { force: true });
  }
}

/** The timestamp back out of a file name. */
const atOf = (name: string): string => {
  const stem = basename(name, '.json');
  // 2026-09-02T01-23-45-678Z -> 2026-09-02T01:23:45.678Z
  return stem.replace(
    /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    (_, date: string, h: string, m: string, s: string, ms: string) =>
      `${date}${h}:${m}:${s}.${ms}Z`,
  );
};

/** Keyed by path, not id: two repos can each hold a design called `app`. */
export function dirFor(project: string): string {
  const digest = createHash('sha1').update(project).digest('hex').slice(0, 10);
  const name = basename(project, '.json').replace(/[^\w.-]/g, '_');
  return join(appDataDir(), 'backups', `${name}-${digest}`);
}
