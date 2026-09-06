/* Reading a stylesheet as a list of rules, and working out which part each one
 * belongs to.
 *
 * This exists so CSS can move OUT of the shared sheets and onto the items it
 * draws. A sheet is what an import starts with — `chat.css` linked from thirty
 * screens, describing components nobody has extracted yet. Every rule that
 * finds its owner is a rule the design system can carry to another project;
 * every rule left behind is one that only makes sense inside this one.
 *
 * A REAL scan, not a regular expression. The first attempt matched selectors
 * with `/([^{}]+)\{/` and reported that one component owned twelve kilobytes of
 * a sheet — it had matched the text of a comment that happened to sit before a
 * brace, and comments in this design are drawn boxes several lines long. A
 * survey that is wrong about ownership would move rules onto the wrong item and
 * only be discovered by looking at the pictures.
 */

/** One rule, with the at-rules it sits inside. */
export interface CssRule {
  /** `.msg-bot .avatar`, exactly as written. */
  selector: string;
  /** Declarations between the braces, untouched. */
  body: string;
  /** The whole rule as it appears in the sheet, the whitespace and comments
   *  before it included — exactly `sheet.slice(start, end)`, so a caller can
   *  cut it out and put the pieces back together. */
  text: string;
  /** Enclosing conditions, outermost first: `['@media (max-width: 700px)']`.
   *  Empty for a rule at the top level. */
  conditions: string[];
  /** Byte offset of `text` in the sheet it came from. */
  start: number;
  end: number;
}

/** At-rules that CONTAIN rules. Everything else — `@keyframes`, `@font-face`,
 *  `@import` — is a leaf: its insides are not selectors and must not be read
 *  as any. */
const CONDITIONAL = /^@(media|supports|container|layer|scope)\b/;

/** Walk past whatever starts at `i`: a comment, a string, or one character. */
function skip(css: string, i: number): number {
  if (css.startsWith('/*', i)) {
    const end = css.indexOf('*/', i + 2);
    return end === -1 ? css.length : end + 2;
  }
  const quote = css[i];
  if (quote === '"' || quote === "'") {
    let j = i + 1;
    while (j < css.length) {
      if (css[j] === '\\') j += 2;
      else if (css[j] === quote) return j + 1;
      else j++;
    }
    return css.length;
  }
  return i + 1;
}

/** The index of the `{` that opens the next block, or -1.
 *
 *  Brace-aware only outside comments and strings: `content: "{"` is a
 *  declaration, not the start of anything. */
function openBrace(css: string, from: number): number {
  let i = from;
  while (i < css.length) {
    if (css[i] === '{') return i;
    if (css[i] === ';' && css.slice(from, i).trim().startsWith('@')) return -1; // @import etc.
    const next = skip(css, i);
    i = next > i ? next : i + 1;
  }
  return -1;
}

/** The index of the `}` closing the block that opens at `open`. */
function closeBrace(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    const next = skip(css, i);
    i = next > i ? next : i + 1;
  }
  return css.length;
}

/** Every rule in a stylesheet, flattened, with its conditions carried along.
 *
 *  Nested rules inside a conditional at-rule come out as rules of their own —
 *  which is what moving CSS needs, since each has to be re-wrapped in its
 *  conditions wherever it lands. */
export function splitRules(css: string, conditions: string[] = [], offset = 0): CssRule[] {
  const out: CssRule[] = [];
  let i = 0;

  while (i < css.length) {
    // Whitespace and comments between rules belong to whatever comes next.
    const from = i;
    while (i < css.length && (/\s/.test(css[i] ?? '') || css.startsWith('/*', i))) {
      i = css.startsWith('/*', i) ? skip(css, i) : i + 1;
    }
    if (i >= css.length) break;

    const open = openBrace(css, i);
    if (open === -1) {
      // A statement at-rule (`@import url(...);`) or trailing junk.
      const semi = css.indexOf(';', i);
      if (semi === -1) break;
      i = semi + 1;
      continue;
    }

    const close = closeBrace(css, open);
    const head = css.slice(i, open).trim();
    const body = css.slice(open + 1, close);

    if (CONDITIONAL.test(head)) {
      out.push(...splitRules(body, [...conditions, head], offset + open + 1));
    } else {
      out.push({
        selector: head,
        body,
        text: css.slice(from, close + 1),
        conditions,
        start: offset + from,
        end: offset + close + 1,
      });
    }
    i = close + 1;
  }
  return out;
}

/* ── who a rule belongs to ──────────────────────────────────────────────── */

/** The classes on the SUBJECT of each selector in the list.
 *
 *  The subject is the rightmost compound: `.chat .msg-bot` styles a message,
 *  not a chat. Getting this backwards would attribute half the sheet to
 *  whichever container happens to wrap things.
 *
 *  Pseudo-elements and pseudo-classes are dropped, except that a functional
 *  pseudo-class taking selectors (`:is`, `:where`, `:not`, `:has`) contributes
 *  the classes inside it — `.tag:not(.tag--dim)` is still about tags. */
export function subjectClasses(selectorList: string): Set<string> {
  const out = new Set<string>();
  for (const one of splitList(selectorList)) {
    const compound = rightmost(one);
    for (const found of compound.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(found[1] ?? '');
  }
  return out;
}

/** Classes that appear anywhere BUT the subject — the context a rule needs. */
export function contextClasses(selectorList: string): Set<string> {
  const out = new Set<string>();
  for (const one of splitList(selectorList)) {
    const compound = rightmost(one);
    const rest = one.slice(0, one.length - compound.length);
    for (const found of rest.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(found[1] ?? '');
  }
  return out;
}

/** Split on commas that are not inside brackets: `:is(a, b)` is one selector. */
function splitList(selectorList: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorList.length; i++) {
    const ch = selectorList[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(selectorList.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = selectorList.slice(start).trim();
  if (last !== '') out.push(last);
  return out.filter((s) => s !== '');
}

/** The last compound selector — what the rule actually styles. */
function rightmost(selector: string): string {
  let depth = 0;
  for (let i = selector.length - 1; i >= 0; i--) {
    const ch = selector[i] ?? '';
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) return selector.slice(i + 1);
  }
  return selector;
}

/** Does this class belong to the part claiming `prefix`?
 *
 *  `.tag`, `.tag__label`, `.tag--dim` and `.tag-label` all do: the separator
 *  is whatever the design already uses, and an import brings its own
 *  convention. `.tagline` does not — a prefix match without a boundary would
 *  hand one part another part's rules. */
export function claims(prefix: string, className: string): boolean {
  if (className === prefix) return true;
  if (!className.startsWith(prefix)) return false;
  const rest = className.slice(prefix.length);
  return rest.startsWith('-') || rest.startsWith('_');
}
