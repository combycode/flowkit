/* composeDocument — a node becomes one self-contained HTML document.
 *
 * Every consumer goes through here: the canvas (via iframe srcdoc), the
 * Chromium sidecar, HTML export and the shared viewer. One function means
 * preview and export cannot disagree — the thing you approve is byte-for-byte
 * the thing that ships.
 *
 * Self-contained is not a nicety. `srcdoc` has no base URL, so a relative
 * href resolves to nothing and fails silently; and a shared project must
 * render offline. Everything is inlined.
 *
 * An item whose markup references others is expanded first — see ./expand.
 * Everything downstream is unchanged by that: the expansion produces ordinary
 * HTML, and an opaque item simply expands to itself.
 */

import { applyStrings } from '../strings/extract';
import type { ItemName, ProjectDoc, RenderContext } from '../types/project';
import { fontCss, themeCss } from './css';
import { expand } from './expand';

export interface Composed {
  html: string;
  /** Items that contributed markup or CSS. The canvas uses it to know which
   *  nodes to re-render when an item changes. */
  used: readonly ItemName[];
  /** Sheets pulled in, for the same reason. */
  sheets: readonly string[];
}

export interface ComposeInput {
  doc: ProjectDoc;
  /** The item to render — a screen in phase 1, a layout once C1 lands. */
  item: ItemName;
  ctx: RenderContext;
  /** Where the styles come from.
   *
   *  `inline` (the default) makes the document genuinely self-contained: it
   *  renders in an srcdoc iframe, in the sidecar, and from a file on a
   *  stranger's machine with no network. That is what the canvas and a
   *  single shared page need.
   *
   *  A folder export wants the opposite. Inlining ~200 KB of stylesheet and
   *  fonts into each of 62 screens produced a 73 MB export of which 99% was
   *  the same bytes repeated. Pointing them at one file makes it about 1 MB.
   *  The unit of self-containment is then the folder rather than the file. */
  styles?: 'inline' | { href: string };
}

/** Every style rule a screen needs, in cascade order.
 *
 *  Shared by the inline path and the linked one, so a linked stylesheet can
 *  never contain something different from what was inlined. */
export function composeStylesheet(
  doc: ProjectDoc,
  themeId: string,
  items?: readonly ItemName[],
): string {
  const theme = doc.kit.themes[themeId];
  const names = items ?? Object.keys(doc.items);
  const sheets = new Set<string>();
  for (const name of names) {
    for (const sheet of doc.items[name]?.sheets ?? []) sheets.add(sheet);
  }

  return [
    theme ? themeCss(theme) : '',
    fontCss(doc.kit, doc),
    doc.kit.base,
    ...[...sheets].map((name) => doc.kit.sheets[name] ?? ''),
    ...names.map((name) => doc.items[name]?.css ?? ''),
  ]
    .filter((s) => s.trim().length > 0)
    .join('\n\n');
}

export function composeDocument({ doc, item, ctx, styles = 'inline' }: ComposeInput): Composed {
  const entry = doc.items[item];
  if (!entry) {
    return { html: notFound(item), used: [], sheets: [] };
  }

  const viewport = doc.viewports.find((v) => v.id === ctx.viewport) ?? doc.viewports[0];

  /* A screen that is still a mockup renders as its picture — but only while it
   * has no markup of its own. The moment somebody writes markup, that is the
   * screen; a picture that kept winning would mean writing markup, rendering,
   * seeing the mockup, and having no way to tell why. */
  if (entry.html.trim() === '' && entry.image !== undefined) {
    const asset = doc.assets[entry.image];
    if (asset) {
      return {
        html: shell({
          lang: ctx.locale,
          title: entry.description ?? item,
          styles: { css: MOCKUP_CSS },
          body: `<img class="df-mockup" alt="${escapeAttr(entry.description ?? item)}" src="data:${asset.mime};base64,${asset.bytes}">`,
          bodyAttrs: { 'data-df-viewport': ctx.viewport, 'data-df-mockup': entry.image },
          width: viewport?.width,
        }),
        used: [item],
        sheets: [],
      };
    }
  }

  // Expand first: which items a screen uses is not knowable until it has been
  // composed, and the stylesheet has to carry the CSS of every one of them or
  // a component renders unstyled.
  const composed = expand(doc, entry.html, entry);
  const used = [item, ...composed.used];
  const sheets = [...new Set(used.flatMap((name) => doc.items[name]?.sheets ?? []))];

  return {
    html: shell({
      lang: ctx.locale,
      title: entry.description ?? item,
      styles: styles === 'inline' ? { css: composeStylesheet(doc, ctx.theme, used) } : styles,
      body: localize(doc, composed.html, ctx.locale),
      /* The viewport is stamped on the document as well as used to size it.
       * A generated page can then draw itself for the viewport being LOOKED
       * at — the kit sheets show a shell at the size the toolbar is set to,
       * rather than at every size at once — and it costs one attribute that
       * nothing else reads. */
      bodyAttrs: { ...(entry.rootAttrs ?? {}), 'data-df-viewport': ctx.viewport },
      width: viewport?.width,
    }),
    used,
    sheets,
  };
}

interface ShellInput {
  lang: string;
  title: string;
  styles: { css: string } | { href: string };
  body: string;
  bodyAttrs: Readonly<Record<string, string>>;
  width: number | undefined;
}

/** A mockup is a picture and nothing else, so it gets a stylesheet of its own
 *  rather than the design's: none of the design's rules apply to an <img>, and
 *  loading them would embed a hundred kilobytes of CSS behind a screenshot.
 *
 *  Full width, so a 390-wide mockup fills a 390 viewport exactly and a
 *  1440-wide one scales down rather than being cropped. */
const MOCKUP_CSS = `html,body{margin:0;padding:0;background:#0f1116}
.df-mockup{display:block;width:100%;height:auto}`;

function shell({ lang, title, styles, body, bodyAttrs, width }: ShellInput): string {
  const attrs = Object.entries(bodyAttrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  const head =
    'css' in styles
      ? `<style>\n${styles.css}\n</style>`
      : `<link rel="stylesheet" href="${escapeAttr(styles.href)}">`;

  // The viewport meta carries the node's width so a screen laid out for a
  // phone reports phone metrics to its own media queries, rather than
  // inheriting whatever size the iframe happens to be.
  const content = width ? `width=${width}, initial-scale=1` : 'width=device-width, initial-scale=1';
  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="${content}">
<title>${escapeText(title)}</title>
${head}
</head>
<body${attrs}>
${body}
</body>
</html>`;
}

function notFound(item: ItemName): string {
  return `<!DOCTYPE html><html><body style="font:14px system-ui;padding:16px">
<b>Missing item</b><br>${escapeText(item)}</body></html>`;
}

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

/** Apply a locale overlay. The default locale needs no work — its text is
 *  already inline in the markup, which is the whole point of keeping it there. */
function localize(doc: ProjectDoc, html: string, locale: string): string {
  if (locale === doc.strings.defaultLocale) return html;
  return applyStrings(html, doc.strings.locales[locale]?.entries ?? {});
}
