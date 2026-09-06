/* ─────────────────────────────────────────────────────────────────────────
   The reducer contract.

   Types only — the pipeline lives in ../apply/apply.ts. Keeping the shapes
   here means a reducer can be written and tested against them without
   importing the dispatcher that runs it.
   ───────────────────────────────────────────────────────────────────────── */

import type { Command } from './commands';
import type { ProjectDoc } from './project';
import type { Rule } from './rules';

/** Commands are named `<domain>.<verb>`, so routing is a string test rather
 *  than a registry that can fall out of sync with the union. */
export type Domain = 'project' | 'item' | 'flow' | 'kit' | 'strings' | 'asset';

export interface Reduction {
  doc: ProjectDoc;
  /** Commands that undo this one, in order. Produced by the reducer because
   *  only it knows what the previous value was. */
  inverse: Command[];
}

/** One domain, one reducer. Each is independently testable with no knowledge
 *  of the others: give it a document and a command, get a document back. */
export interface DomainReducer<C extends Command = Command> {
  domain: Domain;
  /** Type guard, so `reduce` receives a narrowed command rather than a cast. */
  match(cmd: Command): cmd is C;
  /** Existence and reference checks no post-hoc invariant could see — deleting
   *  a node that was never there leaves a perfectly valid document, and
   *  silence would be the wrong answer. Anything expressible as a document
   *  invariant belongs in a rule instead. */
  precheck(doc: ProjectDoc, cmd: C): import('./commands').Diagnostic[];
  /** Pure. Assumes `precheck` returned no errors. Must not mutate `doc`. */
  reduce(doc: ProjectDoc, cmd: C): Reduction;
}

export interface ApplyOptions {
  /** Override the rule set — used by tests to isolate one invariant, and by
   *  the importer, which cannot satisfy the strings rule until it has run. */
  rules?: readonly Rule[];
  /** Report violations without rejecting. */
  lenient?: boolean;
  /** Clock for `updatedAt`. Injected so a test gets a byte-stable document. */
  now?: () => string;
}

/* ── history ───────────────────────────────────────────────────────────── */

/** Undo/redo is the op-log replayed, not a stack of document snapshots — a
 *  62-screen document is far too big to keep fifty copies of, and the log is
 *  also the audit trail and the basis for collaboration later. */
export interface OpLogEntry {
  at: string;
  /** Who wrote it. Worth recording from day one: "which of us changed this" is
   *  the first question asked once a model edits alongside a person. */
  source: 'ui' | 'mcp' | 'agent' | 'import';
  command: Command;
  inverse: Command[];
}
