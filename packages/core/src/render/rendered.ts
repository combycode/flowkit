/* What an item actually renders, for the checks that read markup.
 *
 * A screen used to BE its markup, so a rule could read `item.html` and see
 * every string in it. Composition breaks that: extracting a tab moves the
 * button into the registry and leaves the call site holding its `data-t` in
 * one fill and its label in another. Read raw, that looks like text with no
 * key — and the whole screen turns into warnings about strings that are
 * perfectly well keyed once the component is put back together.
 *
 * So the string checks read this instead: the item as it will ship.
 */

import type { Item, ProjectDoc } from '../types/project';
import { expand } from './expand';

/** The item's markup with every reference expanded — or the markup itself,
 *  when it holds none. */
export function rendered(doc: ProjectDoc, item: Item): string {
  return item.html.includes('<x-') ? expand(doc, item.html, item).html : item.html;
}
