/* Locate text nodes in HTML, by offset, without parsing it into a tree.
 *
 * Offsets rather than a tree because everything downstream is exact string
 * surgery: splice the spans we mean to change and leave every other byte
 * alone. A parse/serialise round-trip would renormalise attribute quoting and
 * whitespace across 62 imported screens, and this design is verified
 * pixel-for-pixel — so "close enough" markup is a fidelity regression.
 *
 * It is a scanner, not a parser: no tree, no error recovery, no ownership
 * rules. It answers one question — where is the visible text, and which
 * element is it directly inside.
 */

/** Elements with no closing tag. */
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

/** Elements whose content is not markup and never user-visible copy. */
const RAW = new Set(['script', 'style', 'title', 'textarea']);

/** Elements whose text is machine data rather than copy. */
const OPAQUE = new Set(['svg', 'path', 'symbol', 'use', 'defs', 'g', 'circle', 'rect']);

export interface TextSpan {
  /** Offsets into the source string. */
  start: number;
  end: number;
}

export interface ElementText {
  tag: string;
  /** Offset just after the tag name, where an attribute can be inserted. */
  attrInsertAt: number;
  /** The whole open tag, for reading existing attributes. */
  openStart: number;
  openEnd: number;
  /** Direct text-node children, in document order. */
  texts: TextSpan[];
}

/** Every element that directly contains visible text, with those text spans.
 *  Elements inside `<svg>`, `<script>` and friends are skipped entirely. */
export function scanText(html: string): ElementText[] {
  const out: ElementText[] = [];
  const stack: ElementText[] = [];
  let opaqueDepth = 0;
  let i = 0;

  const record = (el: ElementText) => {
    if (el.texts.length > 0) out.push(el);
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // Text between the previous tag and this one belongs to the open element.
    if (lt > i && opaqueDepth === 0) {
      const top = stack[stack.length - 1];
      if (top && hasVisibleText(html.slice(i, lt))) top.texts.push({ start: i, end: lt });
    }

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const close = html.indexOf('>', lt);
      i = close === -1 ? html.length : close + 1;
      continue;
    }

    const close = findTagEnd(html, lt);
    if (close === -1) break;
    const inner = html.slice(lt + 1, close);

    if (inner.startsWith('/')) {
      const tag = inner.slice(1).trim().toLowerCase();
      if (OPAQUE.has(tag) && opaqueDepth > 0) opaqueDepth--;
      // Unwind to the matching open tag; unbalanced markup closes nothing.
      const at = findLast(stack, (e) => e.tag === tag);
      if (at !== -1) {
        for (let k = stack.length - 1; k >= at; k--) record(stack[k]!);
        stack.length = at;
      }
      i = close + 1;
      continue;
    }

    const tag = (/^[a-zA-Z][\w:-]*/.exec(inner)?.[0] ?? '').toLowerCase();
    const selfClosing = inner.endsWith('/');

    if (RAW.has(tag) && !selfClosing) {
      const end = html.toLowerCase().indexOf(`</${tag}`, close);
      i = end === -1 ? html.length : end;
      continue;
    }

    if (!selfClosing && !VOID.has(tag)) {
      if (OPAQUE.has(tag)) opaqueDepth++;
      stack.push({
        tag,
        attrInsertAt: lt + 1 + tag.length,
        openStart: lt,
        openEnd: close + 1,
        texts: [],
      });
    }
    i = close + 1;
  }

  for (const el of stack) record(el);
  return out.sort((a, b) => a.openStart - b.openStart);
}

/** End of a tag, respecting quoted attribute values so `>` inside one does
 *  not terminate it early. */
function findTagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from + 1; i < html.length; i++) {
    const c = html[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

/** Copy: contains a letter or a digit once entities are set aside. Punctuation
 *  and whitespace alone are not worth a translation key. */
export function hasVisibleText(text: string): boolean {
  const bare = text.replace(/&[a-zA-Z#0-9]+;/g, '').trim();
  return bare.length > 0 && /[\p{L}\p{N}]/u.test(bare);
}

function findLast<T>(items: T[], match: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (match(items[i]!)) return i;
  return -1;
}
