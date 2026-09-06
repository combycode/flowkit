/* The document, and the command layer's grip on the file.
 *
 * Every write goes through here, and every write is a command — which is the
 * whole point: there is no path that skips validation, so the contract cannot
 * be routed around by editing JSON directly.
 *
 * There can be more than one Store on one file: the MCP server holds one, and
 * the studio holds another so a dragged screen persists. They are separate
 * processes with separate copies, so before applying anything a store checks
 * whether the file moved underneath it and re-reads if it did. Without that,
 * the second writer's next command is computed against a document that never
 * saw the first writer's change, and silently reverts it.
 *
 * Undo remains per-process: the op-log is in memory, so each hand takes back
 * its own edits. Sharing that needs one writer, which is a later change and
 * not one that touches the command contract.
 *
 * It also holds the op-log, which makes undo the log replayed rather than a
 * stack of document copies. A 62-screen document is roughly a megabyte; fifty
 * snapshots of it is not a sensible way to remember fifty edits.
 */

import { rename, stat, writeFile } from 'node:fs/promises';
import type { Command, CommandResult, OpLogEntry, ProjectDoc } from '@flowkit/core';
import { apply, applyAll } from '@flowkit/core';
import { backup } from './backups';
import { exists, readJson } from './fsx';
import { History } from './history';

export interface StoreOptions {
  path: string;
  /** Keep at most this many undo steps. */
  historyLimit?: number;
  /** Keep the undo log and the backups in memory only. Tests that do not care
   *  about either should not leave files in the user's application data. */
  ephemeral?: boolean;
}

/** Rename, retrying briefly.
 *
 *  On Windows a rename fails with EPERM while another process has the target
 *  open — and the studio polls this very file, so a save could fail for no
 *  reason but bad timing. The window is milliseconds; a few retries close it
 *  without pretending a real failure succeeded.
 */
async function replace(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

export class Store {
  private doc: ProjectDoc;
  private readonly path: string;
  private readonly limit: number;
  private readonly ephemeral: boolean;
  /** Survives a restart — see ./history. */
  private log: History = History.none();
  /** A copy is taken before the first change of a session whatever the
   *  throttle says, so "what it looked like when I sat down" always exists. */
  private backedUp = false;
  /** Serialises writes: two tool calls landing together must not interleave
   *  a read-modify-write and lose one of them. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Modification time of the last content this store read or wrote. Anything
   *  else means another writer got there first. */
  private seen = '';

  private constructor(doc: ProjectDoc, options: StoreOptions) {
    this.doc = doc;
    this.path = options.path;
    this.limit = options.historyLimit ?? 100;
    this.ephemeral = options.ephemeral ?? false;
  }

  static async open(options: StoreOptions): Promise<Store> {
    if (!(await exists(options.path))) throw new Error(`No project at ${options.path}`);
    const store = new Store(await readJson<ProjectDoc>(options.path), options);
    store.seen = await signature(options.path);
    // Only kept if it still describes the document actually on disk; a log
    // whose inverses were computed against something else would undo values
    // that never existed.
    store.log = options.ephemeral
      ? History.none()
      : await History.open({ project: options.path, limit: store.limit }, store.doc.updatedAt);
    return store;
  }

  get(): ProjectDoc {
    return this.doc;
  }

  /** The file this store writes. Callers need it to put exports beside it. */
  get file(): string {
    return this.path;
  }

  /** Apply, persist, and record for undo. Rejected commands write nothing. */
  async run(cmd: Command, source: OpLogEntry['source'] = 'mcp'): Promise<CommandResult> {
    return this.serialised(async () => {
      await this.refresh();
      const result = apply(this.doc, cmd, { now: () => new Date().toISOString() });
      if (!result.ok || !result.doc) return result;
      await this.commit(result.doc);
      await this.record({
        at: new Date().toISOString(),
        source,
        command: cmd,
        inverse: result.inverse,
      });
      return result;
    });
  }

  /** All-or-nothing, one entry in the log. */
  async runAll(cmds: readonly Command[], source: OpLogEntry['source'] = 'mcp') {
    return this.serialised(async () => {
      await this.refresh();
      const result = applyAll(this.doc, cmds, { now: () => new Date().toISOString() });
      if (!result.ok || !result.doc) return result;
      await this.commit(result.doc);
      // The sequence undoes as one: a single entry carrying the whole inverse,
      // rather than one per command with only the last of them able to undo.
      await this.record({
        at: new Date().toISOString(),
        source,
        command: cmds[0] ?? { t: 'project.rename', name: this.doc.name },
        inverse: result.inverse,
      });
      return result;
    });
  }

  /** Undo the most recent change. */
  async undo(): Promise<CommandResult | undefined> {
    return this.serialised(async () => {
      await this.refresh();
      const entry = await this.log.pop();
      if (!entry) return undefined;
      if (entry.inverse.length === 0) return undefined;

      const result = applyAll(this.doc, entry.inverse, { now: () => new Date().toISOString() });
      if (result.ok && result.doc) {
        await this.commit(result.doc);
        // The steps left describe how the document got to where it was before
        // this undo. Re-seal, or the next process to open the file finds a log
        // that disagrees with it and discards the lot.
        await this.log.seal(this.doc.updatedAt);
      } else {
        // Could not undo — put the step back rather than lose it.
        await this.log.restore(entry, this.doc.updatedAt);
      }
      return result;
    });
  }

  history(): readonly OpLogEntry[] {
    return this.log.all();
  }

  /** Replace the whole document — recovering from a backup.
   *
   *  Not a command, and deliberately so: it is not an edit to the design but a
   *  statement that this version is the one. A copy of what is being replaced
   *  is taken first, and the undo log is dropped, because every inverse in it
   *  was computed against a document that is no longer here. */
  async restore(doc: ProjectDoc): Promise<void> {
    return this.serialised(async () => {
      await backup(this.path, { force: true }).catch(() => undefined);
      await this.commit({ ...doc, updatedAt: new Date().toISOString() });
      await this.log.clear();
    });
  }

  private async record(entry: OpLogEntry): Promise<void> {
    await this.log.push(entry, this.doc.updatedAt);
  }

  /** Write to a temp file and rename over the original.
   *
   *  A rename is atomic on the same filesystem, so a reader — the studio
   *  polling this very file — never sees a half-written document, and a crash
   *  mid-write cannot leave the project truncated. */
  private async commit(next: ProjectDoc): Promise<void> {
    // Before overwriting, keep the version being replaced. Throttled, except
    // for the first change of a session.
    if (!this.ephemeral) {
      await backup(this.path, { force: !this.backedUp }).catch(() => undefined);
      this.backedUp = true;
    }

    const temp = `${this.path}.tmp`;
    await writeFile(temp, JSON.stringify(next), 'utf8');
    await replace(temp, this.path);
    this.doc = next;
    this.seen = await signature(this.path);
  }

  /** Pick up another writer's change before applying our own.
   *
   *  A command is a function of the document it is applied to — an inverse
   *  computed against a stale copy would undo the wrong thing — so this runs
   *  before every write rather than on a timer. */
  private async refresh(): Promise<void> {
    const now = await signature(this.path);
    if (now === this.seen || now === '') return;
    this.doc = await readJson<ProjectDoc>(this.path);
    this.seen = now;
  }

  private serialised<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    // Keep the chain alive even if this step rejected.
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** A cheap fingerprint of the file's current content: modification time AND
 *  size. Mtime alone is not enough — Bun reports it at millisecond resolution,
 *  so two writes within the same millisecond (a fixture write then an immediate
 *  edit, routine on a fast CI disk) carry an identical mtime and the second
 *  writer never notices the first. Size moves whenever the document's length
 *  does, which any real edit changes, so the pair catches what mtime misses.
 *
 *  Empty string when the file is missing — treated as "nothing to pick up"
 *  rather than as a change, so a store keeps working on a project whose file
 *  was removed instead of throwing on the next command. */
async function signature(path: string): Promise<string> {
  try {
    const s = await stat(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '';
  }
}
