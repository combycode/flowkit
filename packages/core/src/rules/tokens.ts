/* Token rules — one of the two axes that exist before there is a registry.
 *
 * These are what make "the design is controlled by variables" enforceable
 * rather than aspirational: a colour typed literally into an item's CSS is
 * invisible to the theme switcher, and only shows up when someone flips to
 * light and finds a patch that did not move.
 */

import { diagnostic, nearest } from '../apply/diagnostics';
import type { Diagnostic } from '../types/commands';
import type { ProjectDoc } from '../types/project';
import type { Rule } from '../types/rules';

/** Literal colours: hex, rgb()/rgba(), hsl()/hsla(). */
const LITERAL_COLOR = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?)\s*\(/gi;

/** `var(--x)` references. */
const VAR_REF = /var\(\s*(--[\w-]+)/g;

/** Declarations of a custom property, which may legitimately hold a literal —
 *  that is what a token IS. */
const CUSTOM_PROP_DECL = /(--[\w-]+)\s*:\s*([^;}]*)/g;

/** Comments. Prose about a colour is not a colour, and prose about a token is
 *  not a use of one — but both read as the thing to a regular expression. The
 *  rule that binds a status pip's colour to its variant explains, in a comment,
 *  which literal rgba() it replaced, and was reported for saying so. */
const COMMENT = /\/\*[\s\S]*?\*\//g;

/** The CSS with everything that is not a declaration blanked out, keeping the
 *  length so reported line numbers still point into the original. */
const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
const scannable = (css: string): string => css.replace(COMMENT, blank);

export const hardcodedColor: Rule = {
  code: 'hardcoded-color',
  scopes: ['item'],
  check(doc, only) {
    const out: Diagnostic[] = [];
    for (const [name, item] of itemsIn(doc, only)) {
      if (!item.css) continue;
      // Values assigned TO a custom property are the tokens themselves.
      const withoutDecls = scannable(item.css).replace(CUSTOM_PROP_DECL, blank);
      for (const match of withoutDecls.matchAll(LITERAL_COLOR)) {
        out.push(
          diagnostic({
            code: 'hardcoded-color',
            item: name,
            line: lineOf(item.css, match.index ?? 0),
            message:
              `"${match[0]}" is a literal colour in item "${name}". Colours must come from a ` +
              'token so the theme switcher can move them.',
            available: sampleTokens(doc),
          }),
        );
      }
    }
    return out;
  },
};

export const unknownToken: Rule = {
  code: 'unknown-token',
  scopes: ['item', 'theme'],
  check(doc, only) {
    const out: Diagnostic[] = [];
    const known = allTokens(doc);
    for (const [name, item] of itemsIn(doc, only)) {
      if (!item.css) continue;
      for (const match of scannable(item.css).matchAll(VAR_REF)) {
        const token = match[1];
        if (!token || known.has(token)) continue;
        const near = nearest(token, [...known]);
        out.push(
          diagnostic({
            code: 'unknown-token',
            item: name,
            line: lineOf(item.css, match.index ?? 0),
            message: `"${token}" is not defined in any theme.${near ? ` Did you mean "${near}"?` : ''}`,
            ...(near ? { suggestion: near } : {}),
            available: sampleTokens(doc),
          }),
        );
      }
    }
    return out;
  },
};

/** Every theme must define the same token set.
 *
 *  A token present in one theme and missing from another is the single most
 *  common theming bug, and it is invisible until someone switches. Whole-map
 *  set equality catches it for nothing. */
export const tokenNotInAllThemes: Rule = {
  code: 'token-not-in-all-themes',
  scopes: ['theme'],
  check(doc) {
    const out: Diagnostic[] = [];
    const themes = Object.entries(doc.kit.themes);
    if (themes.length < 2) return out;

    const union = allTokens(doc);
    for (const [id, theme] of themes) {
      const missing = [...union].filter((token) => !(token in theme.tokens));
      if (missing.length === 0) continue;
      out.push(
        diagnostic({
          code: 'token-not-in-all-themes',
          message:
            `Theme "${id}" is missing ${missing.length} token(s) that other themes define: ` +
            `${missing.slice(0, 8).join(', ')}. A token defined in only some themes leaves ` +
            'that theme half-styled.',
          available: missing.slice(0, 25),
        }),
      );
    }
    return out;
  },
};

function allTokens(doc: ProjectDoc): Set<string> {
  const out = new Set<string>();
  for (const theme of Object.values(doc.kit.themes)) {
    for (const token of Object.keys(theme.tokens)) out.add(token);
  }
  return out;
}

const sampleTokens = (doc: ProjectDoc): string[] => [...allTokens(doc)].slice(0, 25);

/** The items a scope covers — one item, or all of them. */
export function itemsIn(doc: ProjectDoc, only?: { of: string; name?: string }) {
  if (only?.of === 'item' && only.name) {
    const item = doc.items[only.name];
    return item ? ([[only.name, item]] as const) : [];
  }
  return Object.entries(doc.items);
}

export const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;
