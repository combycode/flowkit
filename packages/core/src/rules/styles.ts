/* Does a part carry the stylesheet that draws it?
 *
 * An item names the sheets it needs, and nothing checked that the sheets it
 * names are the ones its markup actually uses. Get it wrong and the part is
 * not broken in any way you can see from the markup — it simply renders
 * unstyled: the avatar element was lifted out of a header with `chat` and
 * `scrollbars` on it, while `.avatar` is written in `cabinet`, so the kit drew
 * two letters on a dark square and looked merely underwhelming.
 *
 * The check is deliberately loose. A class MENTIONED anywhere in a sheet
 * counts, including inside a compound selector like `.hdr .avatar`, because
 * the question here is "did somebody forget a sheet", not "is this selector
 * the one that matters".
 */

import { diagnostic } from '../apply/diagnostics';
import type { Diagnostic } from '../types/commands';
import type { ProjectDoc } from '../types/project';
import { markups } from '../types/project';
import type { Rule } from '../types/rules';
import { itemsIn } from './tokens';

/** Class names a stylesheet mentions. */
function classesOf(css: string): Set<string> {
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? ''));
}

/** Class names the markup puts on elements. */
function used(html: string): string[] {
  const out = new Set<string>();
  for (const found of html.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
    for (const name of (found[1] ?? '').trim().split(/\s+/)) if (name !== '') out.add(name);
  }
  return [...out];
}

export const unstyledClass: Rule = {
  code: 'unstyled-class',
  scopes: ['item'],
  check(doc: ProjectDoc, only): Diagnostic[] {
    const out: Diagnostic[] = [];

    // Read each sheet once, however many items name it.
    const cache = new Map<string, Set<string>>();
    const sheet = (name: string): Set<string> => {
      const found = cache.get(name);
      if (found) return found;
      const parsed = classesOf(doc.kit.sheets[name] ?? '');
      cache.set(name, parsed);
      return parsed;
    };
    const base = classesOf(doc.kit.base);

    for (const [name, item] of itemsIn(doc, only)) {
      // A generated page is written against the kit's own sheet, which the
      // generator attaches; nobody hand-picks its stylesheets.
      if (item.generated !== undefined) continue;

      const own = classesOf(item.css ?? '');
      const pool = [base, own, ...(item.sheets ?? []).map(sheet)];
      const drawn = new Set(markups(item).flatMap(used));
      for (const variant of Object.values(item.variants ?? {})) {
        for (const cls of (variant.class ?? '').trim().split(/\s+/)) if (cls) drawn.add(cls);
      }
      const missing = [...drawn].filter((cls) => !pool.some((set) => set.has(cls)));
      if (missing.length === 0) continue;

      out.push(
        diagnostic({
          code: 'unstyled-class',
          item: name,
          message:
            `Nothing styles ${missing
              .slice(0, 6)
              .map((c) => `.${c}`)
              .join(', ')}` +
            `${missing.length > 6 ? ` and ${missing.length - 6} more` : ''} in "${name}". ` +
            `It uses ${(item.sheets ?? []).map((s) => `"${s}"`).join(', ') || 'no sheets'} — ` +
            'update_item_sheets adds the one that draws it.',
          available: missing,
        }),
      );
    }

    return out;
  },
};
