/* CSS fragments for a composed document. Each function does one thing and
 * returns a string, so they compose in any order and every one is testable
 * against a literal. */

import type { FontFace, Kit, ProjectDoc, Theme } from '../types/project';

/** A theme becomes custom properties on :root, and grounds the page.
 *
 * Only ONE theme is ever emitted — the one being rendered. There is no
 * `[data-theme]` selector and no media query, because a token whose only
 * definition sits inside a conditional block is the classic way to get a
 * half-themed page. The switch happens by re-composing, not by CSS. */
export function themeCss(theme: Theme): string {
  const decls = Object.entries(theme.tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `:root {\n${decls}\n}${ground(theme)}`;
}

/* A theme that names a background should USE it.
 *
 * Declaring `--bg` does nothing on its own: a project with no base stylesheet
 * renders on the browser's white, and switching theme changes only the parts
 * a screen happens to paint itself. What that looks like is a screen whose
 * content is dark down to where the content stops, and white below it — which
 * reads as a broken render rather than a missing rule, and is exactly what a
 * new project does before anyone has written a reset.
 *
 * Emitted BEFORE the base stylesheet and everything else, so it is only ever a
 * default: a project that grounds its own page overrides this by saying so,
 * which is what both our own kits do. A theme with no such token gets nothing
 * — this guesses at a convention, and a guess should not invent a colour.
 */
const GROUND = '--bg';
const INK = '--text';

function ground(theme: Theme): string {
  const rules = [
    theme.tokens[GROUND] === undefined ? '' : `  background: var(${GROUND});`,
    theme.tokens[INK] === undefined ? '' : `  color: var(${INK});`,
  ].filter(Boolean);

  // Body alone covers the viewport: with no background on `html`, the body's
  // propagates to the canvas.
  return rules.length === 0 ? '' : `\n\nbody {\n${rules.join('\n')}\n}`;
}

/** Fonts as @font-face with the bytes inline.
 *
 * Inline because a composed document must render with no network — that is
 * what makes it identical in the canvas, in the sidecar and in a shared
 * viewer that someone opens on a plane. */
export function fontCss(kit: Kit, doc: ProjectDoc): string {
  return kit.fonts
    .map((face) => faceCss(face, doc))
    .filter(Boolean)
    .join('\n\n');
}

function faceCss(face: FontFace, doc: ProjectDoc): string {
  const asset = doc.assets[face.asset];
  if (!asset) return ''; // a missing asset is a validator's problem, not a crash
  const range = face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : '';
  return [
    '@font-face {',
    `  font-family: '${face.family}';`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
    '  font-display: swap;',
    `  src: url(data:${asset.mime};base64,${asset.bytes}) format('${formatOf(asset.mime)}');${range}`,
    '}',
  ].join('\n');
}

const FORMATS: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
};

const formatOf = (mime: string): string => FORMATS[mime] ?? 'woff2';
