/* Pull custom properties out of a stylesheet.
 *
 * Deliberately not a CSS parser. It reads declaration blocks for a given
 * selector and returns the `--x: value` pairs inside — all the token importer
 * needs, and small enough to be obviously correct.
 *
 * Two things it must get right, both learned from silent failures:
 *
 *  - At-rule blocks are held back, not flattened. STRAIW's tokens.css carries
 *    a RESPONSIVE TYPE SCALE: `:root` inside `@media (min-width: 768px)`,
 *    1200, 1600 and 2200. Merging those into the base map made the 2200px
 *    values win everywhere, so every screen rendered at 20px body text
 *    instead of 17px — plausible-looking, and wrong.
 *
 *  - Selector matching is by containment, not equality. The light theme is
 *    `:root[data-theme='light']`, with single quotes; matching the exact
 *    string `[data-theme="light"]` found nothing and made light silently
 *    identical to dark.
 */

export interface CssSplit {
  /** Rules at the top level of the sheet. */
  top: string;
  /** Whole at-rule blocks (`@media …{ … }`), verbatim and in source order. */
  atRules: string[];
}

/** Separate top-level rules from at-rule blocks, so each can be treated
 *  differently. Brace-counting, because an at-rule body contains rules. */
export function splitAtRules(css: string): CssSplit {
  const source = stripComments(css);
  let top = '';
  const atRules: string[] = [];

  for (let i = 0; i < source.length; ) {
    if (source[i] !== '@') {
      const next = source.indexOf('@', i);
      top += source.slice(i, next === -1 ? source.length : next);
      if (next === -1) break;
      i = next;
      continue;
    }
    const open = source.indexOf('{', i);
    if (open === -1) {
      top += source.slice(i);
      break;
    }
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}' && --depth === 0) break;
    }
    atRules.push(source.slice(i, j + 1));
    i = j + 1;
  }

  return { top, atRules };
}

/** Custom properties declared under `selector`, at the top level only.
 *
 *  Several blocks with the same selector merge in source order, so a later
 *  override wins exactly as it would in the browser. */
export function tokensUnder(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of blocksFor(splitAtRules(css).top, selector)) {
    Object.assign(out, declarations(block));
  }
  return out;
}

/** The at-rule blocks that declare custom properties — the responsive scale.
 *
 *  Kept as CSS rather than absorbed into a theme, because a flat token map
 *  cannot express "17px here, 18px past 1200px". Emitting them after the
 *  theme preserves the design exactly; modelling responsive tokens properly
 *  is a later decision, and one this does not foreclose. */
export function tokenAtRules(css: string): string[] {
  return splitAtRules(css).atRules.filter((rule) => /--[\w-]+\s*:/.test(rule));
}

/** Bodies of every top-level block whose selector list mentions `selector`. */
function blocksFor(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(re)) {
    const sel = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (sel.split(',').some((s) => matches(s.trim(), selector))) bodies.push(body);
  }
  return bodies;
}

/** `:root` matches only `:root`; anything else matches by containment, so
 *  `:root[data-theme='light']` is found by `[data-theme=light]` regardless of
 *  how the source quoted it. */
function matches(sel: string, wanted: string): boolean {
  if (wanted === ':root') return sel === ':root';
  return unquote(sel).includes(unquote(wanted));
}

const unquote = (s: string): string => s.replace(/['"]/g, '');

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split(';')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (name.startsWith('--') && value.length > 0) out[name] = value;
  }
  return out;
}

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
