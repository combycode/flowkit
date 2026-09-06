/* Pull the pieces we need out of a hand-written HTML page.
 *
 * Phase-1 items are opaque, so an imported screen keeps its markup verbatim —
 * we only need to know where the body starts and which stylesheets the page
 * linked. That is a smaller job than parsing, and doing the smaller job means
 * the import cannot subtly rewrite markup that currently renders correctly.
 *
 * When the real parser lands (for `data-t` extraction and validation) it
 * replaces the callers of these, not the guarantee: what is stored is still
 * exactly what STRAIW wrote.
 */

export interface PageParts {
  /** Inner HTML of <body>, verbatim. */
  body: string;
  /** Attributes on the <body> tag — STRAIW uses `class="app"` and
   *  `data-spec="closed"` to drive layout, so dropping them would change the
   *  render. */
  bodyAttrs: string;
  /** hrefs of local <link rel=stylesheet>, in source order. */
  sheets: string[];
  /** Any inline <svg> icon sprite, which STRAIW puts at the top of <body>. */
  title: string;
}

export function pageParts(html: string): PageParts {
  return {
    body: bodyInner(html),
    bodyAttrs: bodyAttrs(html),
    sheets: localSheets(html),
    title: titleOf(html),
  };
}

function bodyInner(html: string): string {
  const open = /<body\b[^>]*>/i.exec(html);
  if (!open) return html;
  const start = open.index + open[0].length;
  const end = html.toLowerCase().lastIndexOf('</body>');
  return (end === -1 ? html.slice(start) : html.slice(start, end)).trim();
}

function bodyAttrs(html: string): string {
  const open = /<body\b([^>]*)>/i.exec(html);
  return (open?.[1] ?? '').trim();
}

/** Local stylesheets only. A Google Fonts <link> is a network dependency and
 *  becomes an inlined @font-face instead, so it is deliberately skipped. */
function localSheets(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href && !/^https?:/i.test(href)) out.push(href);
  }
  return out;
}

function titleOf(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return (m?.[1] ?? '').trim();
}

/** `../packages/styles/src/chat.css` -> `chat`. The sheet's identity in the
 *  kit is its basename: two screens linking the same file must land on the
 *  same sheet or it is stored twice. */
export function sheetName(href: string): string {
  const file = href.split('/').pop() ?? href;
  return file.replace(/\.css$/i, '');
}
