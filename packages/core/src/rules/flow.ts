/* Every canvas node points at a screen that exists, and is one.
 *
 * The command layer already checks this when a node is added or updated. What
 * it did NOT do was check it again over the whole document — so a rename that
 * left sixteen nodes pointing at a screen that no longer existed passed
 * `validate` with "No problems", rendered fine screen-by-screen (a screen is
 * addressed directly, past the node), and only revealed itself as thirty-two
 * black "Missing item" plates in the export. A dangling node→screen reference
 * is exactly the kind of thing validate exists to catch, and it was the one
 * kind it could not see.
 *
 * This runs the SAME per-node check the reducer uses, over every node, as a
 * document-scope rule. Reusing it means the two can never disagree about what
 * a valid node is.
 */

import { checkNode } from '../apply/reducers/flow';
import type { Diagnostic } from '../types/commands';
import type { ProjectDoc } from '../types/project';
import type { Rule } from '../types/rules';

export const danglingNode: Rule = {
  code: 'unknown-item',
  scopes: ['flow', 'item', 'document'],
  check(doc: ProjectDoc): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (const node of Object.values(doc.flow.nodes)) out.push(...checkNode(doc, node));
    /* A WARNING, not an error, even though a dangling node exports as a black
     * plate. `apply` rejects any write whose result has a rule error, so an
     * error here would lock a project that already has one dangling node: every
     * command — including the one that would fix it — runs the rule on a
     * document that still contains the OTHER dangling nodes and is refused.
     * A warning is loud in validate (which was the blind spot — it reported
     * "No problems" over sixteen broken nodes) without that trap. */
    return out.map((d) => ({ ...d, severity: 'warning' as const }));
  },
};
