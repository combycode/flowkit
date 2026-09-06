/* The map: every screen in its place, with the connections drawn between.
 *
 * A model that can only read `list_nodes` knows where things are and still
 * cannot see the shape of the journey — whether a branch reads as a branch,
 * whether a label lands on top of a screen, whether the whole thing is a
 * thicket. This is the picture.
 *
 * It is built from the same parts the canvas is: `placementOf` for where each
 * screen sits, `composeDocument` for what each screen IS. That is deliberate.
 * A map assembled from a second, similar-looking implementation would drift,
 * and then the picture a model corrects against would stop being the thing
 * the person sees.
 *
 * Screens go in iframes rather than inline. A screen is a whole document with
 * its own `<body>` attributes, and `body[data-spec='closed'] .spec` stops
 * matching the moment that body becomes a div — which is exactly how the
 * brief panel once rendered open on every screen that should have had it
 * shut. An iframe keeps a document a document.
 *
 * The stylesheet is written ONCE and injected into every frame by a script in
 * the page. Sixty-two copies of a 200 KB sheet is a 12 MB document to push
 * through a debugger socket, for bytes that are identical every time.
 */

import type { EdgeStyle, ProjectDoc, RenderContext } from '@flowkit/core';
import { composeDocument, composeStylesheet, placementOf, themeCss, toPoint } from '@flowkit/core';
import { escapeCss, escapeJson } from '../embed';

export interface MapPageInput {
  doc: ProjectDoc;
  ctx: RenderContext;
  /** Only this flow. Everything, when absent. */
  group?: string;
  /** Draw each screen's name above it and its caption below. */
  labels?: boolean;
  /** Include the generated pages that a map leaves out.
   *
   *  A map is about journeys, so the kit is not on it. A SELECTION is about
   *  what someone pointed at, and they can point at a kit page — so the page
   *  behind a selection has to hold everything the canvas holds, or the
   *  rectangle lands somewhere else entirely. */
  generated?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapPage {
  html: string;
  /** The box the whole map occupies, in page pixels — what to capture when no
   *  region is asked for. */
  bounds: Rect;
  screens: number;
  edges: number;
}

/** Room above a screen for its name and below it for its caption. */
const CAPTION_TOP = 34;
const CAPTION_BOTTOM = 40;
/** Breathing room around the whole map. */
const MARGIN = 60;

/** Set by the page once every frame has painted and its fonts have loaded.
 *  The sidecar waits on it: capturing before the webfonts arrive photographs
 *  a layout that never existed. */
export const READY_FLAG = '__mapReady';

export function mapPage({
  doc,
  ctx,
  group,
  labels = true,
  generated = false,
}: MapPageInput): MapPage {
  const chosen = doc.viewports.find((v) => v.id === ctx.viewport) ?? doc.viewports[0];

  /* A node may pin its own size, and a kit page must: it is a grid of variants
   * and is unreadable in a phone frame. The toolbar chooses for everything
   * that has not said otherwise -- the same rule the canvas follows, because a
   * map that disagreed with the canvas would be a picture of a layout nobody
   * has. */
  const sizeOf = (node: { viewport?: string; screen: string }) => {
    // A measured size wins — see Item.size.
    const own = doc.items[node.screen]?.size;
    if (own) return own;

    const named = node.viewport ?? doc.items[node.screen]?.viewport;
    const found = (named ? doc.viewports.find((v) => v.id === named) : undefined) ?? chosen;
    return { width: found?.width ?? 390, height: found?.height ?? 844 };
  };

  const cells = placementOf(doc.flow, ctx.viewport);
  const visible = Object.entries(doc.flow.nodes).filter(([, n]) => {
    if (group !== undefined) return (n.groups ?? []).includes(group);
    // A map is about journeys. Generated pages — the kit — are reference
    // material and would sit in the middle of one saying nothing about it.
    // Ask for their flow by name and they appear.
    return generated || doc.items[n.screen]?.generated === undefined;
  });
  const ids = new Set(visible.map(([id]) => id));

  /* The step is the toolbar's viewport, the same one the canvas uses. Sizing
   * it to the largest screen on the map instead spread every phone 1440px
   * apart because a handful of kit pages are desktop. */
  const step = chosen ?? {
    id: 'x',
    label: 'x',
    device: 'mobile' as const,
    width: 390,
    height: 844,
  };

  const placed = visible.map(([id, node]) => {
    const cell = cells[id] ?? { col: 0, lane: 0 };
    const at = toPoint(cell, step);
    return { id, node, x: at.x, y: at.y, ...sizeOf(node) };
  });

  const bounds = boundsOf(placed);
  // Everything is drawn relative to the box, so the map starts at 0,0 however
  // far down the canvas the flow actually sits.
  const shift = { x: -bounds.x, y: -bounds.y };

  const edges = Object.entries(doc.flow.edges).filter(([, e]) => ids.has(e.from) && ids.has(e.to));

  const frames = Object.fromEntries(
    placed.map(({ id, node }) => [
      id,
      composeDocument({
        doc,
        item: node.screen,
        ctx: { ...ctx, ...(node.fixture ? { fixture: node.fixture } : {}) },
        // A placeholder, swapped for the shared stylesheet in the page. The
        // document is otherwise exactly what the canvas and the exporter
        // produce, because it comes from the same function.
        styles: { href: KIT_HREF },
      }).html,
    ]),
  );

  const theme = doc.kit.themes[ctx.theme];

  const html = page({
    css: composeStylesheet(doc, ctx.theme),
    // The map's own chrome — ground, titles, connections — follows the theme
    // being rendered. A dark board behind light screens is not a preview of
    // anything, and white titles on a light ground are simply not there.
    theme: theme ? themeCss(theme) : '',
    frames,
    nodes: placed.map(({ id, node, x, y, width, height }) => ({
      id,
      x: x + shift.x,
      y: y + shift.y,
      width,
      height,
      title: node.title ?? node.screen,
      description: node.description,
    })),
    edges: edges.map(([id, e]) => {
      const from = placed.find((p) => p.id === e.from);
      const to = placed.find((p) => p.id === e.to);
      return {
        id,
        assumed: e.origin === 'auto',
        label: e.label,
        style: e.style,
        // Each end leaves the screen it belongs to, at ITS size: two screens of
        // different shapes are joined edge to edge rather than by a line that
        // starts in mid-air.
        x1: (from?.x ?? 0) + shift.x + (from?.width ?? 0),
        y1: (from?.y ?? 0) + shift.y + (from?.height ?? 0) / 2,
        x2: (to?.x ?? 0) + shift.x,
        y2: (to?.y ?? 0) + shift.y + (to?.height ?? 0) / 2,
      };
    }),
    labels,
    size: bounds,
  });

  return { html, bounds, screens: placed.length, edges: edges.length };
}

const KIT_HREF = 'flowkit-kit.css';

/** The box every screen fits in, each measured at its own size. */
function boundsOf(
  placed: readonly { x: number; y: number; width: number; height: number }[],
): Rect {
  if (placed.length === 0) return { x: 0, y: 0, width: 1, height: 1 };

  const left = Math.min(...placed.map((p) => p.x)) - MARGIN;
  const top = Math.min(...placed.map((p) => p.y)) - CAPTION_TOP - MARGIN;
  const right = Math.max(...placed.map((p) => p.x + p.width)) + MARGIN;
  const bottom = Math.max(...placed.map((p) => p.y + p.height)) + CAPTION_BOTTOM + MARGIN;

  return { x: left, y: top, width: right - left, height: bottom - top };
}

interface PageInput {
  css: string;
  /** The theme's tokens, for the map's chrome to borrow. */
  theme: string;
  frames: Record<string, string>;
  nodes: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
    description: string | undefined;
  }[];
  edges: {
    id: string;
    assumed: boolean;
    label: string | undefined;
    style: EdgeStyle | undefined;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[];
  labels: boolean;
  size: Rect;
}

function page(input: PageInput): string {
  const { size } = input;

  const nodes = input.nodes
    .map(
      (
        n,
      ) => `<div class="n" style="left:${round(n.x)}px;top:${round(n.y)}px;width:${round(n.width)}px">
${input.labels ? `<div class="t">${escapeText(n.title)}</div>` : ''}
<div class="f" style="width:${round(n.width)}px;height:${round(n.height)}px"><iframe data-screen="${escapeAttr(n.id)}" width="${round(n.width)}" height="${round(n.height)}" title="${escapeAttr(n.title)}"></iframe></div>
${input.labels && n.description ? `<div class="d">${escapeText(n.description)}</div>` : ''}
</div>`,
    )
    .join('\n');

  const paths = input.edges
    .map((e) => {
      // A cubic with horizontal control points: every edge crosses one
      // corridor, so the curve stays inside it and never passes under a
      // screen. Straight lines through the same corridor would overlap each
      // other wherever two connections share a column.
      const dx = Math.max(40, (e.x2 - e.x1) / 2);
      const d = `M ${round(e.x1)} ${round(e.y1)} C ${round(e.x1 + dx)} ${round(e.y1)}, ${round(e.x2 - dx)} ${round(e.y2)}, ${round(e.x2)} ${round(e.y2)}`;
      const mid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
      const label = e.label
        ? `<text class="l${e.assumed ? ' a' : ''}" x="${round(mid.x)}" y="${round(mid.y)}" text-anchor="middle">${escapeText(e.label)}</text>`
        : '';
      /* Said outright beats the class. The map and the studio canvas are two
       * different renderers of one document, and a line somebody styled has to
       * look the same in both — otherwise the property exists on screen and
       * disappears the moment it is exported. */
      const stroke = e.style
        ? ` style="${[
            e.style.width !== undefined ? `stroke-width:${e.style.width}` : '',
            e.style.color !== undefined ? `stroke:${escapeAttr(e.style.color)}` : '',
            e.style.dash ? 'stroke-dasharray:8 6' : '',
          ]
            .filter((part) => part !== '')
            .join(';')}"`
        : '';
      return `<path class="e${e.assumed ? ' a' : ''}" d="${d}"${stroke} marker-end="url(#arrow)"/>${label}`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Map</title>
<style>
${input.theme}
/* Every colour names a token with a dark fallback: a project that happens to
   define --bg and --text gets a map in its own theme, and one that does not
   still gets a legible board rather than black on black. */
  html,body{margin:0;padding:0;background:var(--bg,#0f1116);}
  .map{position:relative;width:${round(size.width)}px;height:${round(size.height)}px;}
  .n{position:absolute;}
  .t{font:600 15px/1.3 system-ui,sans-serif;color:var(--text,#e6e8ee);margin-bottom:6px;}
  .d{font:13px/1.4 system-ui,sans-serif;color:var(--text-muted,#8b93a7);margin-top:8px;}
  /* Sizes are written per node now: the screens on one map are no longer all
     the same shape. */
  .f{border-radius:12px;overflow:hidden;background:var(--bg,#000);}
  iframe{border:0;display:block;}
  svg{position:absolute;inset:0;pointer-events:none;}
  .e{fill:none;stroke:var(--text-muted,#5b6478);stroke-width:2.5;}
  .e.a{stroke:var(--text-muted,#414b60);opacity:.55;stroke-dasharray:8 6;}
  .l{font:500 15px system-ui,sans-serif;fill:var(--text,#c3c9d6);paint-order:stroke;stroke:var(--bg,#0f1116);stroke-width:5px;}
  .l.a{fill:var(--text-muted,#8b93a7);font-style:italic;}
  marker path{fill:var(--text-muted,#5b6478);}
</style>
</head>
<body>
<div class="map">
<svg width="${round(size.width)}" height="${round(size.height)}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>
${paths}
</svg>
${nodes}
</div>
<script id="kit" type="text/plain">${escapeCss(input.css)}</script>
<script id="screens" type="application/json">${escapeJson(JSON.stringify(input.frames))}</script>
<script>
${bootstrap()}
</script>
</body>
</html>`;
}

/** Injects the shared stylesheet into each frame, then reports readiness.
 *
 *  Written as a string rather than a module because it runs in the page, not
 *  here. Kept small for the same reason: anything clever in it is untestable
 *  from this side. */
function bootstrap(): string {
  return `(() => {
  const css = document.getElementById('kit').textContent;
  const screens = JSON.parse(document.getElementById('screens').textContent);
  const link = '<link rel="stylesheet" href="${KIT_HREF}">';
  const frames = [...document.querySelectorAll('iframe[data-screen]')];

  const loaded = frames.map((f) => new Promise((done) => {
    f.addEventListener('load', () => done(f), { once: true });
    const html = screens[f.dataset.screen] || '';
    f.srcdoc = html.replace(link, '<style>' + css + '</style>');
  }));

  Promise.all(loaded)
    .then((all) => Promise.all(all.map((f) => {
      const d = f.contentDocument;
      if (!d) return null;
      // A chat is read at its latest message, which is what the design's own
      // exporter captures. Same rule here, so a screen on the map looks like
      // the screen render of it.
      const scroller = [...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4);
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return d.fonts ? d.fonts.ready : null;
    })))
    .then(() => { window.${READY_FLAG} = true; })
    .catch(() => { window.${READY_FLAG} = true; });
})();`;
}

const round = (n: number): number => Math.round(n * 10) / 10;

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');
