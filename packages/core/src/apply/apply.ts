/* The apply pipeline.
 *
 *   1. route      pick the reducer whose domain matches the command
 *   2. precheck   reference and existence checks the reducer alone can make
 *   3. reduce     pure (doc, cmd) -> next doc + inverse. No validation.
 *   4. rules      run invariants over the CANDIDATE document
 *   5. commit     errors -> return the original untouched; else the candidate
 *
 * Step 4 is the load-bearing idea. Rules check a DOCUMENT, not a command, so
 * an invariant is written once and enforced on every path that could break it
 * — including paths added later. Per-command validation would make each new
 * command a fresh chance to forget a check.
 *
 * Rollback is free because documents are immutable: rejecting is simply not
 * returning the candidate. There is never a half-applied state.
 *
 * `apply` owns no domain logic, so it does not grow. Adding a domain is
 * adding a reducer and an entry in the registry; this file does not change.
 */

import { NONE, PHASE_1, run } from '../rules';
import type { Command, CommandResult, Diagnostic } from '../types/commands';
import type { ProjectDoc } from '../types/project';
import type { ApplyOptions, DomainReducer } from '../types/reducers';
import { diagnostic, hasError } from './diagnostics';
import { flowReducer } from './reducers/flow';
import { itemReducer } from './reducers/item';
import { kitReducer } from './reducers/kit';
import { assetReducer, projectReducer } from './reducers/misc';
import { stringsReducer } from './reducers/strings';

export const reducers: readonly DomainReducer[] = [
  projectReducer,
  itemReducer,
  flowReducer,
  kitReducer,
  stringsReducer,
  assetReducer,
] as readonly DomainReducer[];

export function apply(doc: ProjectDoc, cmd: Command, opts: ApplyOptions = {}): CommandResult {
  const reducer = reducers.find((r) => r.match(cmd));
  if (!reducer) {
    return reject([
      diagnostic({
        code: 'unknown-node',
        message: `No reducer handles "${cmd.t}".`,
        available: reducers.map((r) => r.domain),
      }),
    ]);
  }

  const pre = reducer.precheck(doc, cmd);
  if (hasError(pre)) return reject(pre);

  const { doc: candidate, inverse } = reducer.reduce(doc, cmd);
  const set = opts.rules ? { ...PHASE_1, rules: opts.rules } : PHASE_1;
  const found = run(candidate, set);
  const diagnostics = [...pre, ...found];

  if (hasError(diagnostics) && !opts.lenient) return reject(diagnostics);

  return {
    ok: true,
    // The document records when it last changed; the id and creation time do
    // not move. Callers that need byte-stable output pass their own clock.
    doc: { ...candidate, updatedAt: opts.now?.() ?? candidate.updatedAt },
    diagnostics,
    inverse,
  };
}

/** All-or-nothing. Extraction ("pull this header into component:app-header")
 *  is inherently several commands and must never land halfway.
 *
 *  THE RULES JUDGE THE END STATE, not each step on the way to it. A sequence
 *  is a single change made of several writes, and the states in between are
 *  not states the document is ever in: stamping keys into markup leaves them
 *  without entries until the next command adds them, and moving markup into a
 *  new item leaves it in two places or neither depending which order you
 *  write it. Validating those intermediates reports problems that do not
 *  exist and — once a rule is an error rather than a warning — refuses whole
 *  operations that would have been perfectly valid.
 *
 *  Per-command PRECHECKS still run on the document each command actually sees:
 *  they are about whether that command makes sense there ("no node named X"),
 *  which is a different question from whether the result is a valid design. */
export function applyAll(
  doc: ProjectDoc,
  cmds: readonly Command[],
  opts: ApplyOptions = {},
): CommandResult {
  let current = doc;
  const diagnostics: Diagnostic[] = [];
  const inverse: Command[] = [];

  for (const cmd of cmds) {
    // NONE, so each step is checked for whether it can be applied at all and
    // not for whether the half-finished document is a good design.
    const result = apply(current, cmd, { ...opts, rules: NONE.rules });
    diagnostics.push(...result.diagnostics);
    if (!result.ok || !result.doc) return { ok: false, diagnostics, inverse: [] };
    current = result.doc;
    // Undo runs backwards, so the inverse of a sequence is the reversed
    // concatenation of each step's inverse.
    inverse.unshift(...result.inverse);
  }

  const set = opts.rules ? { ...PHASE_1, rules: opts.rules } : PHASE_1;
  const found = run(current, set);
  const all = [...diagnostics, ...found];
  if (hasError(all) && !opts.lenient) return { ok: false, diagnostics: all, inverse: [] };

  return { ok: true, doc: current, diagnostics: all, inverse };
}

/** Every diagnostic in the document, independent of any command. What a
 *  problems panel shows, and what export checks before emitting. */
export const validate = (doc: ProjectDoc, set = PHASE_1): Diagnostic[] => run(doc, set);

const reject = (diagnostics: Diagnostic[]): CommandResult => ({
  ok: false,
  diagnostics,
  inverse: [],
});
