/* A screen that is halfway from a picture to markup.
 *
 * The markup wins as soon as there is any, which is what makes converting a
 * mockup workable — write, render, correct, with the picture sitting behind it.
 * But the picture is then dead weight nobody can see: it is still in the
 * document, still tens or hundreds of kilobytes of base64, and still exported
 * with everything else.
 *
 * Deciding the conversion is finished is a person's call, not this rule's. So
 * it says the picture is no longer shown and leaves it there.
 */

import { diagnostic } from '../apply/diagnostics';
import type { Diagnostic } from '../types/commands';
import type { Rule } from '../types/rules';
import { itemsIn } from './tokens';

export const strandedMockup: Rule = {
  code: 'stranded-mockup',
  scopes: ['item'],
  check(doc): Diagnostic[] {
    const out: Diagnostic[] = [];

    for (const [name, item] of itemsIn(doc)) {
      if (item.image === undefined) continue;

      if (item.html.trim() !== '') {
        const bytes = doc.assets[item.image]?.bytes.length ?? 0;
        out.push(
          diagnostic({
            code: 'stranded-mockup',
            item: name,
            message:
              `"${name}" has markup now, so its mockup is no longer drawn — the picture is ` +
              `carried in the document (${Math.round((bytes * 3) / 4 / 1024)}KB) and exported ` +
              'with everything else. Clear it once the markup is right.',
          }),
        );
        continue;
      }

      if (doc.assets[item.image] === undefined) {
        out.push(
          diagnostic({
            code: 'stranded-mockup',
            item: name,
            message:
              `"${name}" is a mockup of asset "${item.image}", which is not in the document — ` +
              'it renders as nothing at all. Give it a picture again, or give it markup.',
            available: Object.keys(doc.assets).slice(0, 12),
          }),
        );
      }
    }

    /* A picture nothing points at any more.
     *
     * Deleting the screen does not take its mockup with it, and deliberately:
     * cascading a delete through shared bytes is how somebody loses a picture
     * two screens were using. So it is reported instead — same as an orphaned
     * string — and removing it stays a decision rather than a side effect.
     *
     * Images only. A font is referenced from the kit rather than from an item,
     * and reporting every face as orphaned would make this rule noise. */
    const drawn = new Set(
      Object.values(doc.items)
        .map((item) => item.image)
        .filter((id): id is string => id !== undefined),
    );
    for (const [id, asset] of Object.entries(doc.assets)) {
      if (asset.kind !== 'image' || drawn.has(id)) continue;
      out.push(
        diagnostic({
          code: 'stranded-mockup',
          message:
            `Asset "${id}"${asset.label ? ` (${asset.label})` : ''} is a picture no screen ` +
            `uses — ${Math.round((asset.bytes.length * 3) / 4 / 1024)}KB carried in the ` +
            'document and exported with it. Delete it, or point a screen at it.',
        }),
      );
    }

    return out;
  },
};
