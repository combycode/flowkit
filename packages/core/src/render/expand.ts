/* The composer: a screen that references registry items becomes one document.
 *
 * Three constructs and no more.
 *
 *   <x-field variant="confirmed">        use a registry item
 *     <x-fill slot="label">Budget</x-fill>   put something in one of its holes
 *   </x-field>
 *
 *   <div class="f"><x-slot name="label">Label</x-slot></div>   declare a hole
 *
 * No interpolation, no conditions, no loops. That is not minimalism for its
 * own sake: sixty-two real screens were measured before this was written, and
 * not one of them is data-driven. The rows are drawn, not looped. What they DO
 * have is 189 elements carrying a modifier class — `is-confirmed` sixty-seven
 * times — and every single one carries exactly one. So variants are a closed
 * set named in the registry, not an open set of classes invented at each call
 * site. A screen cannot spell `is-confimed`, and the kit page can enumerate
 * what exists, which is what lets it be generated rather than maintained.
 *
 * TEXT STAYS TEXT. Fills carry the caller's markup verbatim, `data-t` and all,
 * so extracting a component moves strings rather than rewriting them and the
 * translation machinery needs no idea this happened.
 *
 * WHITESPACE IS PRESERVED EXACTLY. Between inline elements a newline is a real
 * space; adding or dropping one moves text. That is what makes the promise
 * checkable — extract a component, render before and after, and the pixels
 * must be identical.
 *
 * String-based rather than DOM-based, like everything else here: the bytes we
 * do not touch come out unchanged, which no parse-and-serialise round trip can
 * promise.
 */

import type { Item, ItemName, ProjectDoc } from '../types/project';
import { markupOf, TIER_RANK } from '../types/project';

export interface Expansion {
  html: string;
  /** Every item that contributed markup, innermost included. The caller needs
   *  it to collect CSS: a screen using `<x-field/>` needs the field's rules. */
  used: ItemName[];
  problems: ExpansionProblem[];
}

export interface ExpansionProblem {
  kind: 'unknown-item' | 'wrong-tier' | 'cycle' | 'too-deep' | 'unknown-variant';
  message: string;
  item?: ItemName;
}

/** Deep enough for any real composition, shallow enough that a mistake stops. */
const MAX_DEPTH = 12;

export function expand(doc: ProjectDoc, html: string, parent: Item): Expansion {
  const used: ItemName[] = [];
  const problems: ExpansionProblem[] = [];
  const out = walk(doc, html, parent, [], 0, used, problems);
  return { html: out, used: [...new Set(used)], problems };
}

function walk(
  doc: ProjectDoc,
  html: string,
  parent: Item,
  stack: readonly ItemName[],
  depth: number,
  used: ItemName[],
  problems: ExpansionProblem[],
): string {
  if (depth > MAX_DEPTH) {
    problems.push({
      kind: 'too-deep',
      message: `Composition nested more than ${MAX_DEPTH} deep: ${stack.join(' → ')}.`,
    });
    return html;
  }

  let out = '';
  let at = 0;

  for (;;) {
    const ref = nextReference(html, at);
    if (!ref) {
      out += html.slice(at);
      return out;
    }

    out += html.slice(at, ref.start);
    at = ref.end;

    const item = doc.items[ref.name];
    if (!item) {
      problems.push({
        kind: 'unknown-item',
        item: ref.name,
        message: `No item "${ref.name}". Available: ${Object.keys(doc.items).slice(0, 12).join(', ')}.`,
      });
      continue; // drop the reference; the rest of the screen still renders
    }
    // Before the tier check: a cycle is ALSO a tier violation, since nesting
    // must strictly simplify — but "contains itself" says what is wrong and
    // "a component cannot go inside a component" does not.
    if (stack.includes(ref.name)) {
      problems.push({
        kind: 'cycle',
        item: ref.name,
        message: `"${ref.name}" contains itself: ${[...stack, ref.name].join(' → ')}.`,
      });
      continue;
    }
    if (TIER_RANK[item.tier] >= TIER_RANK[parent.tier]) {
      problems.push({
        kind: 'wrong-tier',
        item: ref.name,
        message:
          `"${ref.name}" is a ${item.tier} and cannot go inside a ${parent.tier}. ` +
          'A thing may only contain things simpler than itself.',
      });
      continue;
    }

    used.push(ref.name);

    // Fills are the CALLER's markup, so they expand in the caller's scope —
    // its stack, its parent tier. Anything else and a component would silently
    // constrain what may be passed into it.
    const fills = new Map<string, string>();
    for (const [slot, content] of readFills(html.slice(ref.innerStart, ref.innerEnd))) {
      fills.set(slot, walk(doc, content, parent, stack, depth + 1, used, problems));
    }

    /* A bare reference means whatever the item says it means. Families like a
     * status dot have no neutral member — `dot` alone is an invisible circle
     * — so the component names the ordinary one and `<x-dot/>` renders it. */
    const named = ref.variant ?? item.defaultVariant;
    const variant = named ? item.variants?.[named] : undefined;
    if (ref.variant && !variant) {
      problems.push({
        kind: 'unknown-variant',
        item: ref.name,
        message:
          `"${ref.name}" has no variant "${ref.variant}". ` +
          `Available: ${Object.keys(item.variants ?? {}).join(', ') || 'none'}.`,
      });
    }

    /* A variant may bring markup of its own; most do not, and inherit. Fills
     * are poured into whichever markup is actually rendering, so a state that
     * arranges its slots differently still receives what the call site passed
     * for them. */
    const body = fillSlots(markupOf(item, named), fills);
    const withClass = variant?.class ? addClass(body, variant.class) : body;
    const withVariant = variant?.attrs ? setAttrs(withClass, variant.attrs) : withClass;

    out += walk(doc, withVariant, item, [...stack, ref.name], depth + 1, used, problems);
  }
}

/* ── finding a reference ────────────────────────────────────────────────── */

interface Reference {
  name: string;
  variant?: string;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}

/** The next `<x-name>` that is not a slot or a fill. */
function nextReference(html: string, from: number): Reference | undefined {
  let at = from;
  for (;;) {
    const found = html.indexOf('<x-', at);
    if (found === -1) return undefined;

    const open = readOpenTag(html, found);
    if (!open) {
      at = found + 3;
      continue;
    }
    if (open.name === 'x-slot' || open.name === 'x-fill') {
      at = open.end;
      continue;
    }

    if (open.selfClosing) {
      return {
        name: open.name.slice(2),
        ...variantOf(open.attrs),
        start: found,
        end: open.end,
        innerStart: open.end,
        innerEnd: open.end,
      };
    }

    const close = findClose(html, open.name, open.end);
    return {
      name: open.name.slice(2),
      ...variantOf(open.attrs),
      start: found,
      end: close === undefined ? html.length : close.end,
      innerStart: open.end,
      innerEnd: close === undefined ? html.length : close.start,
    };
  }
}

const variantOf = (attrs: string): { variant?: string } => {
  const found = /\bvariant\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
  return found ? { variant: found } : {};
};

interface OpenTag {
  name: string;
  attrs: string;
  /** Just past the `>`. */
  end: number;
  selfClosing: boolean;
}

/** Read an open tag, respecting quoted attribute values.
 *
 *  A regex would do until an attribute contains `>` — `title="a > b"` — and
 *  then it would cut the tag in half silently. */
function readOpenTag(html: string, at: number): OpenTag | undefined {
  if (html[at] !== '<') return undefined;

  let i = at + 1;
  while (i < html.length && /[a-zA-Z0-9-]/.test(html[i] ?? '')) i++;
  const name = html.slice(at + 1, i).toLowerCase();
  if (!name.startsWith('x-') || name.length < 3) return undefined;

  const attrsFrom = i;
  let quote: string | undefined;
  while (i < html.length) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') break;
    i++;
  }
  if (i >= html.length) return undefined;

  const attrs = html.slice(attrsFrom, i);
  return { name, attrs, end: i + 1, selfClosing: /\/\s*$/.test(attrs) };
}

/** The matching close tag, counting nested opens of the same name. */
/** The next `</name>` that really is this element's.
 *
 *  A plain search finds `</x-queue-row>` when looking for `</x-queue>`, and
 *  the reference then ends inside its own first child: the container closed
 *  after one row, and the rest of the queue fell outside it. Names are free to
 *  be prefixes of each other, so the character after the name has to be
 *  checked. */
function closeOf(html: string, name: string, from: number): number {
  let at = from;
  for (;;) {
    const found = html.indexOf(`</${name}`, at);
    if (found === -1) return -1;

    const after = html[found + name.length + 2] ?? '';
    if (after === '>' || /\s/.test(after)) return found;

    at = found + 1;
  }
}

function findClose(
  html: string,
  name: string,
  from: number,
): { start: number; end: number } | undefined {
  let depth = 1;
  let at = from;

  for (;;) {
    const nextOpen = html.indexOf(`<${name}`, at);
    const nextClose = closeOf(html, name, at);
    if (nextClose === -1) return undefined;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const open = readOpenTag(html, nextOpen);
      if (open && open.name === name && !open.selfClosing) depth++;
      at = open ? open.end : nextOpen + name.length + 1;
      continue;
    }

    depth--;
    const end = html.indexOf('>', nextClose);
    if (end === -1) return undefined;
    if (depth === 0) return { start: nextClose, end: end + 1 };
    at = end + 1;
  }
}

/* ── slots and fills ────────────────────────────────────────────────────── */

const DEFAULT_SLOT = '';

/** What the caller put inside the reference, by slot name.
 *
 *  Only ITS fills. A component may be passed another component that has fills
 *  of its own — a review chip inside a review bar — and those belong to the
 *  inner reference. Reading them here handed the outer component content
 *  addressed to something else and left the inner one empty, which composed
 *  to a button with nothing in it. So a nested reference is stepped over
 *  whole, and reaches its own readFills when it is expanded in turn.
 */
function readFills(inner: string): Map<string, string> {
  const fills = new Map<string, string>();
  let loose = '';
  let at = 0;

  for (;;) {
    const found = inner.indexOf('<x-', at);
    if (found === -1) {
      loose += inner.slice(at);
      break;
    }

    const open = readOpenTag(inner, found);
    if (!open) {
      loose += inner.slice(at, found + 3);
      at = found + 3;
      continue;
    }

    if (open.name !== 'x-fill') {
      // Somebody else's reference: take it, and everything inside it, as text.
      const close = open.selfClosing ? undefined : findClose(inner, open.name, open.end);
      const end = close ? close.end : open.end;
      loose += inner.slice(at, end);
      at = end;
      continue;
    }

    loose += inner.slice(at, found);
    const slot = /\bslot\s*=\s*"([^"]*)"/.exec(open.attrs)?.[1] ?? DEFAULT_SLOT;
    const close = open.selfClosing ? undefined : findClose(inner, 'x-fill', open.end);

    fills.set(slot, close ? inner.slice(open.end, close.start) : '');
    at = close ? close.end : open.end;
  }

  // Loose content is the default slot — but only when it is really content.
  // Between two <x-fill> elements it is just the newline the author typed,
  // and putting that in a slot would add a space the original never had.
  if (fills.size === 0 || loose.trim() !== '') {
    if (loose !== '' && !(fills.size > 0 && loose.trim() === '')) fills.set(DEFAULT_SLOT, loose);
  }
  return fills;
}

/** Replace every `<x-slot>` in a component with what was passed for it, or
 *  with the default content written inside the slot tag. */
function fillSlots(html: string, fills: ReadonlyMap<string, string>): string {
  let out = '';
  let at = 0;

  for (;;) {
    const found = html.indexOf('<x-slot', at);
    if (found === -1) return out + html.slice(at);

    const open = readOpenTag(html, found);
    if (!open || open.name !== 'x-slot') {
      out += html.slice(at, found + 7);
      at = found + 7;
      continue;
    }

    out += html.slice(at, found);
    const name = /\bname\s*=\s*"([^"]*)"/.exec(open.attrs)?.[1] ?? DEFAULT_SLOT;
    const close = open.selfClosing ? undefined : findClose(html, 'x-slot', open.end);
    const fallback = close ? html.slice(open.end, close.start) : '';

    out += fills.get(name) ?? fallback;
    at = close ? close.end : open.end;
  }
}

/* ── variants ───────────────────────────────────────────────────────────── */

/** Add the variant's classes to the component's root element.
 *
 *  The root only. A variant that reached inside would be a stylesheet written
 *  in the wrong place, and the component would stop being able to change its
 *  own markup without breaking its variants. */
export function addClass(html: string, extra: string): string {
  const at = html.indexOf('<');
  if (at === -1) return html;

  const open = readOpenTagAny(html, at);
  if (!open) return html;

  const existing = /\bclass\s*=\s*"([^"]*)"/.exec(open.attrs);
  if (existing) {
    const merged = `class="${existing[1]} ${extra}"`;
    const start = at + 1 + open.nameLength + (existing.index ?? 0);
    return html.slice(0, start) + merged + html.slice(start + existing[0].length);
  }

  const insertAt = at + 1 + open.nameLength;
  return `${html.slice(0, insertAt)} class="${extra}"${html.slice(insertAt)}`;
}

/** The same markup with these attributes set on the root element.
 *
 *  Replaces one that is already there, appends one that is not. An empty value
 *  writes the bare form — `disabled`, not `disabled=""` — because that is what
 *  a design file has in it, and a screen composed from parts should read like
 *  one somebody wrote.
 *
 *  `class` is deliberately NOT special-cased away: a variant that sets it here
 *  means to replace the root's classes outright, while `Variant.class` adds to
 *  them. Two different intentions, two different fields. */
export function setAttrs(html: string, attrs: Record<string, string>): string {
  let out = html;
  for (const [name, value] of Object.entries(attrs)) {
    out = setAttr(out, name, value);
  }
  return out;
}

function setAttr(html: string, name: string, value: string): string {
  const at = html.indexOf('<');
  if (at === -1) return html;

  const open = readOpenTagAny(html, at);
  if (!open) return html;

  const written = value === '' ? name : `${name}="${value}"`;
  const existing = new RegExp(`\\b${name}(?:\\s*=\\s*"[^"]*")?`).exec(open.attrs);
  if (existing) {
    const start = at + 1 + open.nameLength + (existing.index ?? 0);
    return html.slice(0, start) + written + html.slice(start + existing[0].length);
  }

  const insertAt = at + 1 + open.nameLength;
  return `${html.slice(0, insertAt)} ${written}${html.slice(insertAt)}`;
}

/** The inverse: the same markup with those classes taken off the root.
 *
 *  Extraction needs it. A screen contains `<span class="dot dot-green">`, and
 *  the component underneath it is `<span class="dot">` plus a variant — which
 *  only exists once the modifier has been lifted off. Whether the pair really
 *  is an inverse is not assumed anywhere: the caller composes the result and
 *  compares bytes, so an attribute order this cannot reproduce is caught
 *  rather than shipped. */
export function withoutClass(html: string, extra: string): string {
  const at = html.indexOf('<');
  if (at === -1) return html;

  const open = readOpenTagAny(html, at);
  if (!open) return html;

  const existing = /\s*\bclass\s*=\s*"([^"]*)"/.exec(open.attrs);
  if (!existing) return html;

  const drop = new Set(extra.trim().split(/\s+/));
  const kept = (existing[1] ?? '')
    .trim()
    .split(/\s+/)
    .filter((c) => c !== '' && !drop.has(c));

  // Nothing left means no attribute at all: `class=""` would compose back as
  // `class=" is-on"`, which is not what the screen said.
  const replacement = kept.length > 0 ? `class="${kept.join(' ')}"` : '';
  const start = at + 1 + open.nameLength + (existing.index ?? 0);
  const before = html.slice(0, start);
  const after = html.slice(start + existing[0].length);
  return replacement === '' ? before + after : `${before} ${replacement}${after}`;
}

/** Like readOpenTag but for any element, not just `x-*`. */
function readOpenTagAny(
  html: string,
  at: number,
): { attrs: string; nameLength: number; end: number } | undefined {
  let i = at + 1;
  while (i < html.length && /[a-zA-Z0-9-]/.test(html[i] ?? '')) i++;
  const nameLength = i - (at + 1);
  if (nameLength === 0) return undefined;

  const attrsFrom = i;
  let quote: string | undefined;
  while (i < html.length) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '<' && html.startsWith('<x-slot', i)) {
      /* A slot may stand among the attributes: a component owns the tag and
       * the class, while the call site keeps what belongs to the instance —
       * its `data-t`, its `aria-selected`. Its own `>` is not the end of this
       * tag, and reading it as one loses the class attribute after it. */
      const end = html.indexOf('>', i);
      if (end === -1) break;
      i = end + 1;
      continue;
    } else if (c === '>') break;
    i++;
  }
  if (i >= html.length) return undefined;

  return { attrs: html.slice(attrsFrom, i), nameLength, end: i + 1 };
}
