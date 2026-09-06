/* Matching a shape with holes in it.
 *
 * Exact extraction lifts markup that repeats character for character — a close
 * button, an icon. It cannot lift a chat message, because every message says
 * something different, and those are the parts worth having: the message row,
 * the brief field, the order card.
 *
 * A shape is the component written as it will be stored, with `<x-slot/>`
 * where the content varies:
 *
 *   <div class="row-user"><x-slot/><x-row-edit/></div>
 *
 * Everything outside the holes must match EXACTLY, whitespace and all. That is
 * deliberate: a loose matcher would find shapes nobody meant and rewrite them,
 * and the whole point of extraction is that it changes nothing you can see.
 *
 * Choose the hole at an element boundary and no attribute ever has to be
 * matched loosely: the message body varies, `data-t` and all, so the WHOLE
 * body is the fill. What is left is the part that really is the same.
 */

/** A template split at its holes: n+1 literals around n slots. */
export interface Shape {
  /** The literal text between the holes. `segments[i]` precedes `slots[i]`. */
  segments: string[];
  /** Slot names in order. The empty string is the default slot. */
  slots: string[];
}

export interface ShapeMatch {
  start: number;
  end: number;
  /** What stood in each hole, in slot order. */
  fills: string[];
}

const SLOT = /<x-slot\b([^>]*?)(?:\/>|>[\s\S]*?<\/x-slot>)/g;

/** Read a template into literals and holes, or say why it cannot be one. */
export function parseShape(template: string): Shape | { problem: string } {
  const segments: string[] = [];
  const slots: string[] = [];

  let at = 0;
  for (const found of template.matchAll(SLOT)) {
    segments.push(template.slice(at, found.index));
    slots.push(/\bname\s*=\s*"([^"]*)"/.exec(found[1] ?? '')?.[1] ?? '');
    at = found.index + found[0].length;
  }
  segments.push(template.slice(at));

  if (slots.length === 0) {
    return { problem: 'it has no <x-slot/>, so nothing about it varies' };
  }
  if (new Set(slots).size !== slots.length) {
    return { problem: 'two of its slots have the same name' };
  }

  /* A hole at either end has no wall to stop against: the matcher would have
   * to guess where the content begins or ends, and it would guess wrong on
   * the first screen that put two of these next to each other. */
  if (segments[0] === '') return { problem: 'it starts with a slot, so a match has no left edge' };
  if (segments[segments.length - 1] === '') {
    return { problem: 'it ends with a slot, so a match has no right edge' };
  }
  if (segments.some((s) => s === '')) {
    return { problem: 'two of its slots are adjacent, with nothing to tell them apart' };
  }

  return { segments, slots };
}

/** Elements that never open a level, so a fill is not held open by an <img>. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Every place this shape occurs, left to right and never overlapping.
 *
 *  A hole stops at the first place its closing literal appears AND the content
 *  so far is balanced markup. The balance is the whole trick: the shape of a
 *  message row is `<div class="row-user"><x-slot/></div>`, and the first
 *  `</div>` after the opening closes the div INSIDE it. Stopping there would
 *  cut the row in half. Stopping at the first `</div>` that leaves nothing
 *  open finds the row itself, however deeply it happens to be nested.
 */
export function matchShape(html: string, shape: Shape): ShapeMatch[] {
  const out: ShapeMatch[] = [];
  const first = shape.segments[0] ?? '';
  let from = 0;

  search: for (;;) {
    const start = html.indexOf(first, from);
    if (start === -1) return out;

    let at = start + first.length;
    const fills: string[] = [];

    for (const literal of shape.segments.slice(1)) {
      const next = closes(html, at, literal);
      if (next === -1) {
        // This opening did not lead anywhere; try the next one along.
        from = start + 1;
        continue search;
      }
      fills.push(html.slice(at, next));
      at = next + literal.length;
    }

    out.push({ start, end: at, fills });
    from = at;
  }
}

/** Where `literal` next appears with everything opened since `from` closed
 *  again, or -1. */
function closes(html: string, from: number, literal: string): number {
  let candidate = html.indexOf(literal, from);
  let scanned = from;
  let depth = 0;

  while (candidate !== -1) {
    /* Ever below zero, not just at the end: a region that closes a tag it did
     * not open and then opens another comes back to zero having swapped one
     * for the other. The fill would read `…</button>
<button …` — markup that
     * composes back to the same bytes and can never be moved again. */
    const over = depthOver(html, scanned, candidate, depth);
    if (over.dipped) return -1;

    scanned = candidate;
    depth = over.depth;
    if (depth === 0) return candidate;

    candidate = html.indexOf(literal, candidate + 1);
  }
  return -1;
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** How deep the markup between two offsets leaves you, starting from `depth`,
 *  and whether it ever closed more than it had open. */
function depthOver(
  html: string,
  from: number,
  to: number,
  depth: number,
): { depth: number; dipped: boolean } {
  let dipped = false;
  TAG.lastIndex = from;

  for (;;) {
    const found = TAG.exec(html);
    if (!found || found.index >= to) return { depth, dipped };

    const name = (found[2] ?? '').toLowerCase();
    const attrs = found[3] ?? '';
    if (found[1] === '/') depth -= 1;
    else if (!VOID.has(name) && !attrs.trimEnd().endsWith('/')) depth += 1;
    if (depth < 0) dipped = true;
  }
}

/* ── fills have to be whole ─────────────────────────────────────────────── */

/** Why this fragment is not balanced markup, or undefined if it is.
 *
 *  The byte comparison that guards extraction cannot catch a hole cut in the
 *  wrong place: putting `</div><div class="x">` into a slot composes back to
 *  exactly the original bytes. What it produces is a fill that is not a
 *  fragment, and the next person to edit that screen finds markup that cannot
 *  be moved without breaking. So the fills are checked for themselves.
 */
export function unbalanced(html: string): string | undefined {
  const stack: string[] = [];
  const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

  for (const found of html.matchAll(tags)) {
    const closing = found[1] === '/';
    const name = (found[2] ?? '').toLowerCase();
    const attrs = found[3] ?? '';

    if (closing) {
      const open = stack.pop();
      if (open === undefined) return `it closes </${name}> without opening it`;
      if (open !== name) return `it closes </${name}> where <${open}> is still open`;
      continue;
    }
    if (VOID.has(name) || attrs.trimEnd().endsWith('/')) continue;
    stack.push(name);
  }

  return stack.length > 0 ? `<${stack[stack.length - 1]}> is never closed` : undefined;
}
