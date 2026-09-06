/* Has anything generated fallen behind what it was generated from?
 *
 * A generated page or sheet that is out of date is worse than a missing one:
 * it is a picture of a design system that no longer exists, and nothing about
 * it looks wrong. The kit sheets are rebuilt by `build_kit` and the utilities
 * rebuild themselves after every write — but a document can also be changed
 * by other means, and then only this says so.
 */

import { diagnostic } from '../apply/diagnostics';
import { staleKitPages } from '../kits/page';
import { TAILWIND_SHEET, tailwindStale } from '../kits/tailwind';
import type { Diagnostic } from '../types/commands';
import type { ProjectDoc } from '../types/project';
import type { Rule } from '../types/rules';

export const staleGenerated: Rule = {
  code: 'stale-generated',
  // Markup, the registry and stylesheets all feed something generated, and a
  // narrower scope would miss the case that matters.
  scopes: ['item', 'theme', 'document'],
  check(doc: ProjectDoc): Diagnostic[] {
    const out: Diagnostic[] = [];

    const pages = staleKitPages(doc);
    if (pages.length > 0) {
      out.push(
        diagnostic({
          code: 'stale-generated',
          message:
            `${pages.join(', ')} ${pages.length === 1 ? 'is' : 'are'} behind the registry — ` +
            'showing a design system that has moved on. build_kit rewrites them.',
          available: pages,
        }),
      );
    }

    if (tailwindStale(doc)) {
      out.push(
        diagnostic({
          code: 'stale-generated',
          message:
            `The "${TAILWIND_SHEET}" sheet was built from different markup than the screens ` +
            'now have, so a screen may be missing the utilities it uses. build_tailwind ' +
            'rewrites it.',
        }),
      );
    }

    return out;
  },
};
