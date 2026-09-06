/* ─────────────────────────────────────────────────────────────────────────
   The rule contract.

   One rule, one invariant, one function. The rule set is a list, so adding
   `tier-violation` at C2 is appending an entry rather than editing a
   monolith, and any rule can be tested in isolation against a document.

   Rules describe the DOCUMENT, never the command that produced it. That is
   what lets `item.setHtml`, `item.create` and the importer all be caught by
   the same check without any of them knowing the check exists.

   Types only — the rules and sets live in ../rules.
   ───────────────────────────────────────────────────────────────────────── */

import type { Diagnostic, DiagnosticCode } from './commands';
import type { ItemName, ProjectDoc } from './project';

/** Narrows what has to be re-checked after a change. A rule that reads one
 *  item should not rescan sixty-two of them on every keystroke. */
export type RuleScope =
  | { of: 'item'; name: ItemName }
  | { of: 'theme' }
  | { of: 'flow' }
  | { of: 'strings' }
  | { of: 'document' };

export interface Rule {
  code: DiagnosticCode;
  /** Which scopes this rule reads, so the runner can skip it when nothing in
   *  those scopes changed. */
  scopes: readonly RuleScope['of'][];
  /** Pure. `only` narrows the work when the runner knows what changed; absent
   *  means check the whole document. */
  check(doc: ProjectDoc, only?: RuleScope): Diagnostic[];
}

/** A rule may be an error or a warning depending on how far a project has
 *  come — an imported design is full of unkeyed text on day one, and failing
 *  every command until that is fixed would make import useless. Severity is
 *  therefore a property of the SET, not of the rule. */
export interface RuleSet {
  id: string;
  rules: readonly Rule[];
  severity: Partial<Record<DiagnosticCode, 'error' | 'warning'>>;
}
