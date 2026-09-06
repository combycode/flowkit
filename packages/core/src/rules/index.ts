/* The rule sets.
 *
 * Severity belongs to the SET, not to the rule. The same
 * `untranslated-text` check is an error in a maturing project and a warning
 * during import — an imported design is full of unkeyed text on day one, and
 * failing every command until it is fixed would make import useless.
 */

import type { Diagnostic, DiagnosticCode } from '../types/commands';
import type { ProjectDoc } from '../types/project';
import type { Rule, RuleScope, RuleSet } from '../types/rules';
import { danglingNode } from './flow';
import { staleGenerated } from './generated';
import { strandedMockup } from './mockup';
import { missingString, orphanedString, untranslatedText } from './strings';
import { unstyledClass } from './styles';
import { hardcodedColor, tokenNotInAllThemes, unknownToken } from './tokens';
import { variantSlots } from './variants';

/** Everything checkable before there is a registry — tokens and strings, the
 *  two axes that exist for plain HTML. */
const PHASE_1_RULES: readonly Rule[] = [
  hardcodedColor,
  unknownToken,
  tokenNotInAllThemes,
  untranslatedText,
  missingString,
  orphanedString,
  unstyledClass,
  staleGenerated,
  variantSlots,
  strandedMockup,
  danglingNode,
];

export const PHASE_1: RuleSet = {
  id: 'phase-1',
  rules: PHASE_1_RULES,
  severity: {
    // A literal colour is a real defect, but blocking the write helps nobody
    // — the author still has to see the CSS to fix it.
    'hardcoded-color': 'warning',
    'token-not-in-all-themes': 'warning',
    'untranslated-text': 'warning',
    'missing-string': 'warning',
    // A part that renders unstyled is a real defect, but blocking the write
    // helps nobody: the fix is naming another sheet, which is another write.
    'unstyled-class': 'warning',
    // Rebuilding is a command away, and refusing writes until somebody runs it
    // would stop the work that made it stale in the first place.
    'stale-generated': 'warning',
    // A slot that differs between states is sometimes deliberate — a panel with
    // no scrim has nothing to put in one. Worth saying, not worth blocking.
    'variant-slots': 'warning',
    // A picture behind finished markup is waste, not a defect: the author is
    // the one who knows whether the conversion is done.
    'stranded-mockup': 'warning',
    'unknown-token': 'error',
  },
};

/** Import: everything demoted, so a design can be brought in exactly as it is
 *  and the remaining work is visible rather than blocking. */
export const IMPORT: RuleSet = {
  id: 'import',
  rules: PHASE_1_RULES,
  severity: Object.fromEntries(
    PHASE_1_RULES.map((r) => [r.code, 'warning' as const]),
  ) as RuleSet['severity'],
};

/** Nothing but structural preconditions. For tests that want one invariant in
 *  isolation, and for callers who only care that references resolve. */
export const NONE: RuleSet = { id: 'none', rules: [], severity: {} };

export function run(doc: ProjectDoc, set: RuleSet, changed?: RuleScope): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const rule of set.rules) {
    // Skip a rule that cannot be affected by what changed. With no scope
    // given, everything runs.
    if (changed && !rule.scopes.includes(changed.of)) continue;
    for (const found of rule.check(doc, changed)) {
      out.push({ ...found, severity: severityOf(set, found.code, found.severity) });
    }
  }
  return out;
}

const severityOf = (
  set: RuleSet,
  code: DiagnosticCode,
  fallback: 'error' | 'warning',
): 'error' | 'warning' => set.severity[code] ?? fallback;

export { staleGenerated } from './generated';
export { missingString, orphanedString, untranslatedText } from './strings';
export { unstyledClass } from './styles';
export { hardcodedColor, tokenNotInAllThemes, unknownToken } from './tokens';
