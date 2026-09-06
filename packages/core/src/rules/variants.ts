/* A variant that brings markup of its own is the one place where a state can
 * stop being the same shape as the thing it is a state of.
 *
 * That is the point — a panel with a scrim and one without really are different
 * markup — but it opens a hole nothing else can see: the call site writes
 * `<x-fill slot="label">`, the variant it happens to be using has no `label`
 * slot, and the words are dropped. No error, no empty box, just missing text on
 * one screen out of sixty.
 */

import { diagnostic } from '../apply/diagnostics';
import type { Diagnostic } from '../types/commands';
import type { Rule } from '../types/rules';
import { itemsIn } from './tokens';

/** The slot names a piece of markup declares, in the order it declares them. */
function slotsOf(html: string): Set<string> {
  const out = new Set<string>();
  for (const found of html.matchAll(/<x-slot\b([^>]*)>/g)) {
    out.add(/\bname\s*=\s*"([^"]*)"/.exec(found[1] ?? '')?.[1] ?? '');
  }
  return out;
}

const label = (slot: string): string => (slot === '' ? 'the default slot' : `"${slot}"`);

export const variantSlots: Rule = {
  code: 'variant-slots',
  scopes: ['item'],
  check(doc): Diagnostic[] {
    const out: Diagnostic[] = [];

    for (const [name, item] of itemsIn(doc)) {
      const base = slotsOf(item.html);

      for (const [id, variant] of Object.entries(item.variants ?? {})) {
        if (variant.html === undefined) continue; // inherits, so it cannot drift

        const own = slotsOf(variant.html);
        const lost = [...base].filter((slot) => !own.has(slot));
        const extra = [...own].filter((slot) => !base.has(slot));
        if (lost.length === 0 && extra.length === 0) continue;

        const said = [
          lost.length > 0
            ? `${lost.map(label).join(', ')} ${lost.length === 1 ? 'is' : 'are'} in "${name}" but not in its "${id}" markup`
            : '',
          extra.length > 0
            ? `${extra.map(label).join(', ')} ${extra.length === 1 ? 'is' : 'are'} only in the "${id}" markup`
            : '',
        ].filter((part) => part !== '');

        out.push(
          diagnostic({
            code: 'variant-slots',
            item: name,
            message:
              `${said.join('; ')}. A screen that fills a slot the rendering markup does not ` +
              'have loses what it passed, silently — give every variant the same set of ' +
              'slots, or leave the ones that differ out of the call site.',
            available: [...new Set([...base, ...own])].map((slot) => slot || '(default)'),
          }),
        );
      }
    }

    return out;
  },
};
