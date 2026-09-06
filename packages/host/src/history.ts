/* Undo that survives closing the window.
 *
 * The op-log used to live in memory and die with the process, which meant
 * every edit made before the last restart was permanent. For a single-file
 * document with no version history behind it, that is the thing most likely
 * to lose someone's work: you notice the mistake tomorrow, and there is
 * nothing to take it back with.
 *
 * Kept beside the application, not beside the project. A design belongs in
 * the repo and gets committed; a log of how it got there is local, churns on
 * every keystroke, and is nobody's business but this machine's.
 *
 * A PATCH CAN CARRY ABSENCE. `inversePatch` names every key a command ADDED,
 * with the value `undefined`, because that is what removes it again — a patch
 * that merely omits the key would leave it behind and the undo would be a
 * quiet no-op. `JSON.stringify` drops exactly those keys, so writing the log
 * out naively destroys the one thing the inverse exists to say. They are
 * encoded, and decoded back into keys that are present and undefined.
 *
 * THE FINGERPRINT IS THE POINT. An inverse is only valid against the document
 * it was computed from — undoing `node.update` restores the value that node
 * had, and if the file has since been replaced from a backup or edited by
 * something else, that value is a lie. The newest entry records the state the
 * log expects to find; if it does not match the document being opened, the log
 * is discarded rather than applied to a document it never saw.
 *
 * That is a claim about the LOG, not about the entry — which is why an undo
 * has to re-seal it. Undoing writes a new `updatedAt`, so without re-sealing
 * the remaining entries still describe the state before it, the next process
 * to open the file sees a mismatch, and everything older than the last undo is
 * thrown away. In one process it worked and across two it did not, which is
 * exactly the case persisting the log exists for.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { OpLogEntry } from '@flowkit/core';
import { exists } from './fsx';
import { appDataDir } from './paths';

/** An entry plus the document state it produced. */
interface Recorded extends OpLogEntry {
  /** `updatedAt` of the document AFTER this command. */
  after: string;
}

export interface HistoryOptions {
  /** The project file this is the history of. */
  project: string;
  /** How many steps to keep. */
  limit?: number;
  /** How large the file may get before old steps are dropped.
   *
   *  An inverse can be big — undoing an edit to a screen carries the whole
   *  previous screen — so a hundred of them is not a fixed size. */
  maxBytes?: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class History {
  private constructor(
    private readonly file: string,
    private readonly limit: number,
    private readonly maxBytes: number,
    private entries: Recorded[],
  ) {}

  /** Load the log for a project, keeping it only if it still describes the
   *  document that is actually there. */
  static async open(options: HistoryOptions, updatedAt: string): Promise<History> {
    const file = fileFor(options.project);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

    const entries = await load(file);
    const newest = entries[entries.length - 1];

    if (newest && newest.after !== updatedAt) {
      // The document moved on without us. Applying these inverses would write
      // values from a document that no longer exists.
      await rm(file, { force: true });
      return new History(file, limit, maxBytes, []);
    }

    return new History(file, limit, maxBytes, entries);
  }

  /** No persistence — for a store that has nowhere to keep one. */
  static none(): History {
    return new History('', DEFAULT_LIMIT, DEFAULT_MAX_BYTES, []);
  }

  all(): readonly OpLogEntry[] {
    return this.entries;
  }

  get length(): number {
    return this.entries.length;
  }

  async push(entry: OpLogEntry, after: string): Promise<void> {
    const recorded: Recorded = { ...entry, after };
    this.entries.push(recorded);

    if (this.file === '') return;
    await mkdir(join(appDataDir(), 'history'), { recursive: true });

    // Appending keeps a write O(1) whatever the log has grown to; the whole
    // file is only rewritten when it needs trimming.
    await appendFile(this.file, `${encode(recorded)}\n`, 'utf8').catch(() => undefined);
    await this.trim();
  }

  /** Take the newest step off, for undoing it. */
  async pop(): Promise<OpLogEntry | undefined> {
    const entry = this.entries.pop();
    if (entry) await this.rewrite();
    return entry;
  }

  /** Say which document state this log is now valid against.
   *
   *  Called after an undo has been written: the entries left describe how the
   *  document got to where it was BEFORE the undo, and the newest of them has
   *  to admit that the document has moved. */
  async seal(updatedAt: string): Promise<void> {
    const newest = this.entries[this.entries.length - 1];
    if (!newest || newest.after === updatedAt) return;
    newest.after = updatedAt;
    await this.rewrite();
  }

  /** Put back a step that could not be undone, rather than losing it. */
  async restore(entry: OpLogEntry, after: string): Promise<void> {
    this.entries.push({ ...entry, after });
    await this.rewrite();
  }

  async clear(): Promise<void> {
    this.entries = [];
    if (this.file !== '') await rm(this.file, { force: true });
  }

  private async trim(): Promise<void> {
    const overLimit = this.entries.length > this.limit;
    const overSize = bytesOf(this.entries) > this.maxBytes;
    if (!overLimit && !overSize) return;

    while (
      this.entries.length > 1 &&
      (this.entries.length > this.limit || bytesOf(this.entries) > this.maxBytes)
    ) {
      this.entries.shift();
    }
    await this.rewrite();
  }

  /** Whole-file write through a temp file: a log truncated by a crash halfway
   *  through is worse than no log, because it would silently undo the wrong
   *  thing. */
  private async rewrite(): Promise<void> {
    if (this.file === '') return;
    const body = this.entries.map(encode).join('\n');
    const temp = `${this.file}.tmp`;
    try {
      await mkdir(join(appDataDir(), 'history'), { recursive: true });
      await writeFile(temp, body === '' ? '' : `${body}\n`, 'utf8');
      await rename(temp, this.file);
    } catch {
      // Losing the ability to persist undo must not stop the edit itself.
    }
  }
}

const bytesOf = (entries: readonly Recorded[]): number =>
  entries.reduce((sum, e) => sum + encode(e).length, 0);

/* An inverse says "this key had no value" by holding the key with `undefined`.
 * JSON has no way to write that: `JSON.stringify({a: undefined})` is `{}`, and
 * the undo silently stops clearing anything. So absence is written as a marker
 * and read back as a key that exists and is undefined — which is NOT the same
 * as a key that is absent, and is the whole difference between an undo that
 * works and one that quietly does nothing. */
const ABSENT = '\u0000df-undefined';

const encode = (entry: Recorded): string =>
  JSON.stringify(entry, (_key, value: unknown) => (value === undefined ? ABSENT : value));

function decode(line: string): Recorded {
  return reviveAbsent(JSON.parse(line)) as Recorded;
}

/** A reviver cannot do this: returning `undefined` from one DELETES the key,
 *  which is the state we are trying to avoid. It has to be a second pass. */
function reviveAbsent(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((v) => (v === ABSENT ? undefined : reviveAbsent(v)));
  }
  if (node !== null && typeof node === 'object') {
    const out = node as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      out[key] = out[key] === ABSENT ? undefined : reviveAbsent(out[key]);
    }
    return out;
  }
  return node;
}

async function load(file: string): Promise<Recorded[]> {
  if (!(await exists(file))) return [];
  try {
    const text = await readFile(file, 'utf8');
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [decode(line)];
        } catch {
          // One damaged line should not cost the whole history.
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Keyed by the project's PATH, not its id: two repos can each hold a design
 *  called `app`, and their histories are not interchangeable. */
export function fileFor(project: string): string {
  const digest = createHash('sha1').update(project).digest('hex').slice(0, 10);
  const name = basename(project, '.json').replace(/[^\w.-]/g, '_');
  return join(appDataDir(), 'history', `${name}-${digest}.jsonl`);
}
