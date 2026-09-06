/* The kit pages, generated from the registry.
 *
 * Not a screen somebody draws and then forgets to update. Every swatch is a
 * token that exists, every row is an item in the registry, every column is a
 * variant it declares — so a page that shows a colour proves the colour is
 * there, and a component that has gone missing takes its row with it.
 *
 * The component page is COMPOSED, not described: it emits `<x-field
 * variant="confirmed"/>` and lets the composer render it, exactly as a screen
 * would. That is what stops it drifting in the way that matters — the kit
 * cannot show a button that no longer looks like that, because it is the same
 * button.
 *
 * Written into the project as real items rather than conjured at render time,
 * so they export with everything else and `get_item` shows what is actually
 * there. The cost is that a generated page CAN go stale if the registry moves
 * underneath it; `staleKitScreens` is how that becomes a visible, fixable
 * condition rather than a quiet lie.
 */

import type { Item, ItemName, ProjectDoc, Theme, Tier } from '../types/project';
import { markupOf } from '../types/project';

/** The name every generated page starts with, and the flow they live in. */
export const KIT_PREFIX = 'kit-';
export const KIT_GROUP = 'kit';
export const KIT_SHEET = 'kit';

/** The sprite of every glyph the design draws, so a frame can take a copy. */
const SPRITE_ID = 'kit-sprite';

export interface KitPage {
  name: ItemName;
  title: string;
  description: string;
  html: string;
}

/** Every page the current document would produce.
 *
 *  Four, one per layer of the design, and each appears only once it has
 *  something on it. FOUNDATION is what everything is made of and exists from
 *  the first day of a project: colour, type, sizes, and the icons drawn from
 *  the sprite. The other three are the registry, split the way the tiers are —
 *  elements, then the parts built out of them, then the shells.
 *
 *  Splitting by tier is what keeps a page short enough to look at. One page of
 *  everything was thirty rows long and read as a scroll rather than a sheet. */
export function kitPages(doc: ProjectDoc): KitPage[] {
  const pages: KitPage[] = [
    {
      name: `${KIT_PREFIX}foundation`,
      title: 'Foundation',
      description: 'Colour, type, sizes and icons — what everything else is made of',
      html: foundationPage(doc),
    },
  ];

  for (const layer of LAYERS) {
    const names = partsOf(doc, layer.tiers);
    if (names.length === 0) continue;

    pages.push({
      name: `${KIT_PREFIX}${layer.id}`,
      title: layer.title,
      description: layer.description,
      html: componentsPage(layer.title, names, doc),
    });
  }

  return pages;
}

/** Everything of these tiers that a person authored.
 *
 *  Not `registryItems`: that answers a different question — what a SCREEN may
 *  reference — and a layout is not that. The kit shows layouts all the same,
 *  because they are part of the design system whether or not a screen may name
 *  one. */
function partsOf(doc: ProjectDoc, tiers: readonly (Tier | undefined)[]): ItemName[] {
  return Object.entries(doc.items)
    .filter(
      ([name, item]) => tiers.includes(item.tier) && item.generated === undefined && !isKit(name),
    )
    .map(([name]) => name)
    .sort();
}

/** The registry pages, in the order a design is built. */
const LAYERS: readonly {
  id: string;
  title: string;
  description: string;
  tiers: readonly (Tier | undefined)[];
}[] = [
  {
    id: 'elements',
    title: 'Elements',
    description: 'The smallest shared parts, and each variant they declare',
    tiers: ['element'],
  },
  {
    id: 'components',
    title: 'Components',
    description: 'The parts a person recognises',
    tiers: ['component'],
  },
  {
    id: 'containers',
    title: 'Containers',
    description: 'What holds the parts, and places itself on the page',
    tiers: ['container'],
  },
  {
    id: 'layouts',
    title: 'Layouts',
    description: 'The shells a screen is poured into',
    tiers: ['layout'],
  },
];

/** Items a screen may reference: everything that is not itself a screen or a
 *  generated page — layouts included, since a screen's first reference IS its
 *  layout. */
export function registryItems(doc: ProjectDoc): ItemName[] {
  return Object.entries(doc.items)
    .filter(
      ([name, item]) => item.tier !== 'screen' && item.generated === undefined && !isKit(name),
    )
    .map(([name]) => name)
    .sort();
}

/** What `Item.generated` says on a page this module wrote. */
export const KIT_GENERATOR = 'kit';

export const isKit = (name: string): boolean => name.startsWith(KIT_PREFIX);

/** Pages whose stored markup is no longer what the registry would produce.
 *
 *  A generated page that has fallen behind is worse than no page: it is a
 *  picture of a design system that does not exist any more, and nothing about
 *  it looks wrong. */
export function staleKitPages(doc: ProjectDoc): ItemName[] {
  return kitPages(doc)
    .filter((page) => {
      const item = doc.items[page.name];
      return item !== undefined && item.html !== page.html;
    })
    .map((page) => page.name);
}

/* ── the pages ──────────────────────────────────────────────────────────── */

type Token = [name: string, value: string];

const isColour = ([, value]: Token): boolean =>
  /^(#|rgb|hsl|color\()/i.test(value.trim()) ||
  /^var\(--(bg|text|accent|surface|border)/i.test(value.trim());

const isLength = ([name, value]: Token): boolean =>
  /^-?[\d.]+(px|rem|em|%|vh|vw)$/.test(value.trim()) && !/font|leading|weight/i.test(name);

const isType = ([name]: Token): boolean => /font|text-|leading|weight|tracking/i.test(name);

/** Colour, type, sizes and icons on one sheet.
 *
 *  They belong together: they are the vocabulary rather than the design, they
 *  are short, and they are the only part of a kit that exists before anything
 *  has been extracted. */
function foundationPage(doc: ProjectDoc): string {
  const theme = doc.kit.themes[doc.kit.defaultTheme];
  const tokens = theme ? Object.entries(theme.tokens) : [];

  return page(
    'Foundation',
    'Switch the theme in the toolbar — every swatch follows, because these are the same tokens the screens use.',
    [
      section('Colour', colourSection(tokens)),
      section('Type', typeSection(tokens, doc)),
      section('Sizes', sizesSection(tokens)),
      section('Icons', iconsSection(doc)),
    ].join(''),
  );
}

const section = (title: string, body: string): string =>
  `<section class="kit-part">
    <header class="kit-part__head"><h2>${esc(title)}</h2></header>
    ${body}
  </section>`;

function colourSection(tokens: readonly Token[]): string {
  const colours = tokens.filter(isColour);
  if (colours.length === 0)
    return '<p class="kit-note">No colour tokens yet — set_token adds one.</p>';

  return `<div class="kit-swatches">${colours
    .map(
      ([name, value]) => `
      <figure class="kit-swatch">
        <div class="kit-chip" style="background: var(${name})"></div>
        <figcaption><code>${esc(name)}</code><span>${esc(value)}</span></figcaption>
      </figure>`,
    )
    .join('')}</div>`;
}

function typeSection(tokens: readonly Token[], doc: ProjectDoc): string {
  const sizes = tokens.filter(([name, value]) => /text-|font-size/i.test(name) && /\d/.test(value));
  const families = [...new Set(doc.kit.fonts.map((f) => f.family))];
  const other = tokens.filter(isType).filter(([n]) => !sizes.some(([s]) => s === n));

  return [
    `<p class="kit-note">${
      families.length > 0
        ? `Embedded: ${esc(families.join(', '))}.`
        : 'No webfonts embedded — this is the system stack. add_font changes that.'
    }</p>`,
    ...[
      sizes.length === 0
        ? '<p class="kit-note">No size tokens yet.</p>'
        : `<div class="kit-rows">${sizes
            .map(
              ([name, value]) => `
      <div class="kit-row">
        <code>${esc(name)}</code>
        <span class="kit-sample" style="font-size: var(${name})">Sphinx of black quartz</span>
        <span class="kit-value">${esc(value)}</span>
      </div>`,
            )
            .join('')}</div>`,
      other.length === 0
        ? ''
        : `<h3>Everything else about type</h3><div class="kit-list">${other
            .map(([n, v]) => `<div><code>${esc(n)}</code><span>${esc(v)}</span></div>`)
            .join('')}</div>`,
    ],
  ].join('');
}

function sizesSection(tokens: readonly Token[]): string {
  const lengths = tokens.filter(isLength);
  if (lengths.length === 0)
    return '<p class="kit-note">No size tokens yet — set_token adds one.</p>';

  return `<div class="kit-rows">${lengths
    .map(
      ([name, value]) => `
      <div class="kit-row">
        <code>${esc(name)}</code>
        <span class="kit-bar" style="width: var(${name})"></span>
        <span class="kit-value">${esc(value)}</span>
      </div>`,
    )
    .join('')}</div>`;
}

/** Every glyph the design defines, from the sprite itself.
 *
 *  Not from the registry: an icon is a `<symbol>` in an SVG sprite that the
 *  screens inline, and it is a glyph whether or not anybody has lifted it into
 *  an item. Reading the sprite means the sheet is complete on the first day of
 *  a project, and an icon that is drawn but never used still shows up — which
 *  is exactly when you want to see it. */
function iconsSection(doc: ProjectDoc): string {
  const ids = symbolIds(doc);
  if (ids.length === 0) {
    return '<p class="kit-note">No icons — this design draws none, or draws them inline.</p>';
  }

  /* A sprite is drawn one of two ways and the sheet cannot ask which: a
   * stroke sprite is bare paths that inherit `stroke: currentColor`, and
   * rendering it with the browser's default `fill: black` gives a grid of
   * black blobs. So the markup is read: a symbol that paints itself says
   * `fill=` somewhere, and anything else is strokes. */
  const painted = /<symbol[^>]*>[\s\S]*?fill="(?!none)/.test(symbolDefs(doc));

  return `${symbolDefs(doc)}<div class="kit-icons${painted ? ' kit-icons--fill' : ''}">${ids
    .map(
      (id) => `
      <figure class="kit-icon">
        <div class="kit-icon__stage">
          <svg class="kit-glyph" aria-hidden="true"><use href="#${esc(id)}"/></svg>
        </div>
        <figcaption><code>${esc(id)}</code></figcaption>
      </figure>`,
    )
    .join('')}</div>`;
}

/** The ids the sprite defines, in the order a person would look for them. */
function symbolIds(doc: ProjectDoc): string[] {
  const ids = new Set<string>();
  for (const item of Object.values(doc.items)) {
    if (item.generated) continue;
    for (const found of item.html.matchAll(/<symbol id="([^"]+)"/g)) {
      if (found[1]) ids.add(found[1]);
    }
  }
  return [...ids].sort();
}

/* An icon is `<use href="#i-back"/>` and the shape it points at is defined
 * somewhere else — an SVG sprite that every screen inlines. Rendered on its
 * own, such a component resolves to nothing and the page is a grid of empty
 * boxes, which looks like the kit is broken when it is the component that is
 * not self-contained.
 *
 * So the page collects the definitions its components need. A `<symbol>` is a
 * definition rather than a component: it has no appearance, belongs in no row,
 * and simply has to be present for the things that use it. */
function symbolDefs(doc: ProjectDoc): string {
  const byId = new Map<string, string>();

  for (const item of Object.values(doc.items)) {
    if (item.generated) continue;
    for (const found of item.html.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g)) {
      const id = found[1];
      // First definition wins, and a second spelling of the same id is the
      // project's problem to resolve, not this page's to arbitrate.
      if (id !== undefined && !byId.has(id)) byId.set(id, found[0]);
    }
  }

  if (byId.size === 0) return '';
  /* Named, because a part drawn in a frame of its own needs a copy of it. An
   * icon is `<use href="#i-check">`, and a reference like that is resolved
   * inside its OWN document — so a sprite sitting on the sheet is invisible to
   * every frame on it, and every icon in every part quietly disappeared: a
   * tick box became a green square, the send button a blue disc. */
  return `<svg id="${SPRITE_ID}" style="display:none" aria-hidden="true">${[...byId.values()].join('')}</svg>`;
}

/** A row per item, a column per variant — and every cell is the real thing,
 *  referenced through the composer rather than described. */
function componentsPage(title: string, names: readonly ItemName[], doc: ProjectDoc): string {
  const rows = names
    .map((name) => {
      const item = doc.items[name];
      if (!item) return '';
      const columns = columnsOf(item);

      // A shell is drawn as a page, at the viewport being looked at.
      if (item.tier === 'layout') {
        return framedRow(name, item, doc);
      }

      // A container is between the two. It places itself on a page and is often
      // `position: fixed` — so it needs a window with a viewport, like a shell,
      // not a content-fit cell where a sidebar that is translateX(-100%) off
      // screen on mobile collapses to an empty card. But it also DECLARES
      // variants worth seeing — with-mandate, mini — which the shell treatment
      // dropped, captioning the one frame with a viewport instead. So it gets a
      // windowed frame PER VARIANT, at the width it is designed for.
      if (item.tier === 'container') {
        return containerRow(name, item, doc);
      }

      /* A PART goes in a frame too, and for the same reason a shell does: a
       * media query looks at the window. A third of this design's registry —
       * the composer, the client's band, an attachment chip, the panel's
       * footer — is written differently above 1200px, and drawn straight onto
       * a 1536-wide sheet every one of them shows its desktop self whatever
       * the toolbar says. The panel footer was worse than wrong: on desktop it
       * is `display: none` unless the page says `data-commit`, so it appeared
       * as an empty box and nothing said why.
       *
       * Unlike a shell, its height is its CONTENT's — a chip in a 844px frame
       * would be a picture of one chip and a lot of nothing. */
      return `
      <section class="kit-part">
        <header class="kit-part__head">
          <code>${esc(name)}</code>
          <span class="kit-tier">${esc(item.tier)}</span>
          ${item.description ? `<span class="kit-desc">${esc(item.description)}</span>` : ''}
        </header>
        <div class="kit-variants">${columns
          .map(({ variant, label }) => partFrame(doc, name, variant, label))
          .join('')}</div>
      </section>`;
    })
    .join('');

  const frames = rows.includes('data-shell=') ? frameScript() : '';
  return page(title, `${names.length} in the registry.`, symbolDefs(doc) + rows + frames);
}

/* ── what to put in a slot ──────────────────────────────────────────────── */

/** A cell for this item, filled the way the design fills it.
 *
 *  A component with a slot renders as an empty box on its own — `<x-msg-user/>`
 *  is a chat bubble with no message in it — and a page of empty boxes says
 *  nothing about the design. The content comes from the first screen that
 *  really uses it, so the kit shows the component as it actually appears and
 *  invents nothing: there is no sample text to write, and none to keep true.
 */
function cell(doc: ProjectDoc, name: ItemName, variant: string): string {
  const open = variant === '' ? `<x-${name}` : `<x-${name} variant="${esc(variant)}"`;
  const item = doc.items[name];
  // The markup THIS cell renders: a variant may bring its own, with slots the
  // base does not have, or none where the base has one.
  const html = item ? markupOf(item, variant === '' ? undefined : variant) : '';
  if (!item || !html.includes('<x-slot')) return `${open}/>`;

  /* A LAYOUT is filled with its own region names rather than with a call
   * site. Its call site is a whole screen, which would put the entire design
   * in one cell — and what there is to see about a shell is which regions it
   * has, where they sit and how big they are.
   *
   * WHICH MEANS IT HAS TO BE SHOWN AS A PAGE. A shell lays its regions out
   * against the page element — `.app` is a flex column at full height, and
   * that is what pins the composer to the bottom and lets the body scroll —
   * so drawn in a plain box it is four stacked rectangles that look nothing
   * like the design. The page element is reproduced here, with the same
   * attributes the screens that use this layout put on their own body. */
  if (item.tier === 'layout') {
    const regions = slotNames(html)
      .map(
        (slot) =>
          `<x-fill slot="${esc(slot)}"><div class="kit-region">${esc(slot || 'default')}</div></x-fill>`,
      )
      .join('');
    return `<div ${pageAttrs(doc, name)}>${open}>${regions}</x-${name}></div>`;
  }

  const inner = firstCall(doc, name, variant) ?? firstCall(doc, name) ?? '';
  return inner === '' ? `${open}/>` : `${open}>${inner}</x-${name}>`;
}

/** One variant of a part, in a window of its own at the active viewport.
 *
 *  The body carries the STATE attributes of a screen that uses the part —
 *  `data-commit`, `data-spec` — because those say what mode the app is in, and
 *  rules key off them. It does NOT carry that screen's class: `.app` is the
 *  page's own geometry, a full-height flex column that becomes a grid, and a
 *  lone chip is not a page. Borrowing it made every part as tall as a phone
 *  and auto-placed some of them into grid cells they never asked for. */
function partFrame(doc: ProjectDoc, name: ItemName, variant: string, label: string): string {
  const id = `kit-part-${name}-${variant || 'default'}`;
  const sizes = Object.fromEntries(
    doc.viewports.map((v) => [v.id, { label: v.label, width: v.width, height: v.height }]),
  );

  return `
          <figure class="kit-variant">
            <template id="${esc(id)}">${cell(doc, name, variant)}</template>
            <div class="kit-stage kit-stage--part">
              <div class="kit-crop">
                <iframe class="kit-frame" title="${esc(name)}"
                  data-shell="${esc(id)}" data-fit="content"
                  data-root="${esc(stateAttrs(doc, name))}"
                  data-sizes="${esc(JSON.stringify(sizes))}"></iframe>
              </div>
            </div>
            <figcaption>${esc(label)}</figcaption>
          </figure>`;
}

/** A shell or a container, drawn once per viewport.
 *
 *  Because a media query looks at the WINDOW: a shell drawn in a 390px box on
 *  a 1440px sheet still lays itself out with its desktop rules — a two-column
 *  grid crammed into a phone, which is a picture of nothing. A frame has its
 *  own window, so inside one of 390px the phone rules apply and inside one of
 *  1440 the desktop ones do. A shell IS two arrangements, so the sheet shows
 *  both rather than picking. */
function framedRow(name: ItemName, item: Item, doc: ProjectDoc): string {
  const example = exampleOf(doc, name);
  const regions = slotNames(item.html)
    .map((slot) => `<x-fill slot="${esc(slot)}">${region(doc, example, slot)}</x-fill>`)
    .join('');

  /* ONE frame, at the viewport being looked at.
   *
   * Every viewport at once was a sheet twice as long saying the same thing
   * twice, and it stops being an answer at all once a project has three or
   * four of them. Which one is decided in the page, from the stamp the
   * composer leaves, because the sheet is stored markup and cannot know at
   * build time what somebody will later switch the toolbar to. */
  const id = `kit-shell-${name}`;
  const sizes = Object.fromEntries(
    doc.viewports.map((v) => [v.id, { label: v.label, width: v.width, height: v.height }]),
  );

  const frames = `
        <figure class="kit-variant">
          <div class="kit-stage kit-stage--frame">
            <iframe class="kit-frame" title="${esc(name)}"
              data-shell="${id}" data-root="${esc(pageAttrs(doc, name))}"
              data-viewport="${esc(item.viewport ?? '')}"
              data-sizes="${esc(JSON.stringify(sizes))}"></iframe>
          </div>
          <figcaption data-kit-caption></figcaption>
        </figure>`;

  return `
      <section class="kit-part kit-part--layout">
        <header class="kit-part__head">
          <code>${esc(name)}</code>
          <span class="kit-tier">${esc(item.tier)}</span>
          ${item.description ? `<span class="kit-desc">${esc(item.description)}</span>` : ''}
        </header>
        <template id="${id}"><x-${name}>${regions}</x-${name}></template>
        <div class="kit-variants">${frames}</div>
      </section>`;
}

/** A container, drawn once PER VARIANT, each in a viewport window.
 *
 *  A part is drawn content-fit and a shell one-per-viewport; a container is
 *  neither. It declares variants like a component, so the sheet shows a frame
 *  for each — default, then with-mandate, mini — rather than one frame with a
 *  viewport caption. And it places itself on a page, often `position: fixed`,
 *  so each frame is a WINDOW at the width the container is designed for: a
 *  sidebar that is off-screen on a phone is drawn at its own desktop viewport
 *  where it is actually visible, not collapsed to an empty card. */
function containerRow(name: ItemName, item: Item, doc: ProjectDoc): string {
  const example = exampleOf(doc, name);
  const sizes = Object.fromEntries(
    doc.viewports.map((v) => [v.id, { label: v.label, width: v.width, height: v.height }]),
  );

  const frames = columnsOf(item)
    .map(({ variant, label }) => {
      const id = `kit-container-${name}-${variant || 'default'}`;
      // A variant may bring its own markup with its own slots, so the regions
      // are read from the markup THIS column renders.
      const html = markupOf(item, variant === '' ? undefined : variant);
      const regions = slotNames(html)
        .map((slot) => `<x-fill slot="${esc(slot)}">${region(doc, example, slot)}</x-fill>`)
        .join('');
      const open = variant === '' ? `<x-${name}` : `<x-${name} variant="${esc(variant)}"`;

      return `
        <figure class="kit-variant">
          <template id="${id}">${open}>${regions}</x-${name}></template>
          <div class="kit-stage kit-stage--frame">
            <iframe class="kit-frame" title="${esc(name)}"
              data-shell="${id}" data-root="${esc(pageAttrs(doc, name))}"
              data-viewport="${esc(item.viewport ?? '')}"
              data-sizes="${esc(JSON.stringify(sizes))}"></iframe>
          </div>
          <figcaption>${esc(label)}</figcaption>
        </figure>`;
    })
    .join('');

  return `
      <section class="kit-part kit-part--layout">
        <header class="kit-part__head">
          <code>${esc(name)}</code>
          <span class="kit-tier">${esc(item.tier)}</span>
          ${item.description ? `<span class="kit-desc">${esc(item.description)}</span>` : ''}
        </header>
        <div class="kit-variants">${frames}</div>
      </section>`;
}

/** What to draw in one region of a shell.
 *
 *  A label, unless a screen fills that region with a single part — then the
 *  part itself, empty. Which matters more than it sounds: a region has no
 *  geometry of its own when the thing that goes in it brings its own, and the
 *  sheet is exactly that. It is a sheet over the page on a phone and the
 *  second column on a desktop, and the shell only says WHERE in the sense of
 *  "not in the flow with the others" — so a label drawn in its place is not
 *  where the panel goes, it is a band at the bottom that never existed.
 *
 *  Anything more than a single reference stays a label: the sheet is a diagram
 *  of the parts, not a copy of a screen. */
function region(doc: ProjectDoc, example: Item | undefined, slot: string): string {
  const label = `<div class="kit-region">${esc(slot || 'default')}</div>`;
  if (!example) return label;

  const filled = fillFor(example.html, slot);
  const one = /^<x-([a-zA-Z][\w-]*)\b[^>]*(?:\/>|>\s*<\/x-\1>)$/.exec(filled.trim());

  return one ? `<x-${one[1]}/>` : label;
}

/** What a call site passes for one slot, or ''. */
function fillFor(html: string, slot: string): string {
  const open = new RegExp(`<x-fill\\s+slot="${slot}"\\s*>`).exec(html);
  if (!open?.index) return '';

  const from = open.index + open[0].length;
  const close = html.indexOf('</x-fill>', from);
  return close === -1 ? '' : html.slice(from, close);
}

/** The screen the shell is drawn as.
 *
 *  Both the page attributes and the fills come from it, and from the SAME one:
 *  taking the state from a screen with the panel closed and the fills from one
 *  with it open would draw a page that nobody has.
 *
 *  The first one, not the fullest: a sheet is a diagram of the regions, and a
 *  screen with its panel open covers the regions the diagram is about. */
function exampleOf(doc: ProjectDoc, layout: ItemName): Item | undefined {
  return Object.values(doc.items).find(
    (item) => item.generated === undefined && item.html.includes(`<x-${layout}`),
  );
}

/** How wide a kit sheet has to be to hold what is on it.
 *
 *  A frame is drawn at its viewport's REAL width, because that is the width
 *  the design's media queries answer to — so the sheet has to be wider than
 *  the widest of them. Scaling the frame down instead is the obvious thing and
 *  it is wrong twice over: it is a transform on a nested document, which
 *  headless Chromium rasterises out of place, and it makes every measurement
 *  on the sheet a lie by the scale factor. */
export function sheetWidth(doc: ProjectDoc): number {
  const widest = Math.max(0, ...doc.viewports.map((v) => v.width));
  return Math.max(1440, widest + 96);
}

/** Fills each shell frame with this page's own styles and the shell markup.
 *
 *  Written as a string because it runs in the page rather than here. A frame
 *  cannot be given its content as markup — an iframe ignores its children —
 *  and inlining a whole document per frame would put the entire stylesheet in
 *  the project file several times over. */
function frameScript(): string {
  return `<script>
(() => {
  const styles = [...document.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  // The icon sprite goes in too: <use href="#i-check"> resolves inside its own
  // document, and without a copy every icon in every frame is a blank.
  const sprite = document.getElementById('${SPRITE_ID}');
  const glyphs = sprite ? sprite.outerHTML : '';
  // Which viewport this sheet is being looked at in — see composeDocument.
  const active = document.body.dataset.dfViewport;

  for (const frame of document.querySelectorAll('iframe[data-shell]')) {
    const shell = document.getElementById(frame.dataset.shell);
    if (!shell) continue;

    const sizes = JSON.parse(frame.dataset.sizes || '{}');
    // A frame drawn at the item's OWN designed viewport (set_item_meta
    // viewport) wins over the toolbar's — a container fixed off-screen on a
    // phone is drawn at the desktop it was designed for. Otherwise it follows
    // whatever the toolbar is switched to.
    const size = sizes[frame.dataset.viewport] || sizes[active] || Object.values(sizes)[0];
    if (size) {
      frame.width = size.width;
      // A PART is as tall as what is in it; a shell is as tall as its viewport.
      frame.height = frame.dataset.fit === 'content' ? 1 : size.height;
      const caption = frame.closest('figure').querySelector('[data-kit-caption]');
      if (caption) caption.textContent = size.label + ' · ' + size.width + 'px';
    }

    // Written rather than set as srcdoc: srcdoc loads on its own schedule, and
    // a screenshot taken in between is a picture of an empty frame. This is
    // synchronous, so by the time the page has parsed, the frames are laid out.
    const inner = frame.contentDocument;
    inner.open();
    inner.write(
      '<!doctype html><html><head><meta charset="utf-8">' + styles +
      '</head><body ' + (frame.dataset.root || '') + '>' + glyphs + shell.innerHTML + '</body></html>'
    );
    inner.close();

    /* A part frame takes the height of what it holds. The BODY's own box, not
     * the document's scroll height: the frame is one pixel tall at this point,
     * and a document that short reports its own clipped height rather than its
     * content's.
     *
     * Measured three times, and the last one is the one that counts. The first
     * is synchronous, so a screenshot taken the moment the page parses already
     * has laid-out frames. But the design's typeface arrives as a data URI and
     * is not ready yet: in the fallback face the text is narrower, wraps into
     * fewer lines, and every tall part came out cropped by about one line —
     * the message band cut off mid-word, the file chips missing a row. So it
     * is measured again when the frame's own fonts are ready, and once more on
     * load for anything else that settles late. */
    if (frame.dataset.fit === 'content') {
      const fit = () => {
        /* A part that is INLINE where it stands alone has no box at all: a
         * state pip is an 8px <span>, and width and height do nothing to an
         * inline box. In the design it is always inside a flex row — a status
         * pill, a chip — which blockifies it. On a sheet of its own it needs
         * that done for it, or the dot row is four empty squares.
         *
         * Only what actually computes to inline: a pill is inline-FLEX and
         * would lose its own layout if this were applied to everything. */
        for (const el of inner.body.children) {
          if (inner.defaultView.getComputedStyle(el).display === 'inline') {
            el.style.display = 'inline-block';
          }
        }

        const box = Math.ceil(inner.body.getBoundingClientRect().height);
        // The document's scroll height as well, and it is the one that catches
        // what the body's own box does not: a margin that collapses out of it,
        // a band that wraps past it. Useless on the first pass, when the frame
        // is 1px and the document is clipped to that — which is why the later
        // passes exist.
        frame.height = Math.max(
          box,
          inner.body.scrollHeight,
          inner.documentElement.scrollHeight,
          48,
        );

        /* The WINDOW stays the viewport's width, because that is what the
         * design's media queries answer to. What is SHOWN is cropped to the
         * part: a send button is a 40px circle, and a 390px window around it
         * turned the elements sheet into a column of black ribbons with
         * something small at the far left of each.
         *
         * The right edge of the content, not the window: a part that really
         * does stretch — a chip told to grow where it lives — reports the full
         * width and keeps it, which is the truth about that part. */
        let edge = 0;
        for (const el of inner.body.children) {
          edge = Math.max(edge, Math.ceil(el.getBoundingClientRect().right));
        }
        frame.parentElement.style.width = Math.max(edge, 48) + 'px';
      };
      fit();
      if (inner.fonts && inner.fonts.ready) inner.fonts.ready.then(fit);
      addEventListener('load', fit);
    }
  }
})();
</script>`;
}

/** The page element a layout is drawn inside, borrowed from the first screen
 *  that uses it.
 *
 *  A design's shell class is its own — STRAIW writes `class="app"` and reads
 *  `data-spec` off the same element — and nothing here could guess it. The
 *  screens say it, so the sheet asks them. */
function pageAttrs(doc: ProjectDoc, layout: ItemName): string {
  const attrs = { ...(exampleOf(doc, layout)?.rootAttrs ?? {}) };
  attrs.class = `kit-page ${attrs.class ?? ''}`.trim();

  return Object.entries(attrs)
    .map(([key, value]) => `${esc(key)}="${esc(value)}"`)
    .join(' ');
}

/** The same, for a part rather than a page.
 *
 *  Everything a screen puts on its root, class included. Dropping the class
 *  was tried first, on the reasoning that `.app` is the page's geometry and a
 *  lone chip is not a page — and every part on the sheet came out in Times,
 *  because that same rule is where the design sets its typeface, its colour
 *  and its ground. A page class is inheritance as much as layout. The geometry
 *  is turned off in the kit's own stylesheet instead, where it can be turned
 *  off by name. */
function stateAttrs(doc: ProjectDoc, name: ItemName): string {
  const attrs = { ...(exampleOf(doc, name)?.rootAttrs ?? {}) };
  attrs.class = `kit-page kit-part-page ${attrs.class ?? ''}`.trim();

  return Object.entries(attrs)
    .map(([key, value]) => `${esc(key)}="${esc(value)}"`)
    .join(' ');
}

/** The slots an item declares, in the order it declares them. */
function slotNames(html: string): string[] {
  return [...html.matchAll(/<x-slot\b([^>]*?)(?:\/>|>)/g)].map(
    (found) => /\bname\s*=\s*"([^"]*)"/.exec(found[1] ?? '')?.[1] ?? '',
  );
}

/** What the first real call site passes to this item, or undefined.
 *
 *  With a variant, only a call site using THAT variant will do — a status is
 *  "Needs budget" or "In review", and showing the blocked one under the done
 *  one would be a picture of something nobody wrote. */
function firstCall(doc: ProjectDoc, name: ItemName, variant?: string): string | undefined {
  for (const [from, item] of Object.entries(doc.items)) {
    if (item.generated || from === name) continue;

    let at = item.html.indexOf(`<x-${name}`);
    while (at !== -1) {
      const openEnd = item.html.indexOf('>', at);
      const tag = openEnd === -1 ? '' : item.html.slice(at, openEnd + 1);
      const named = /\bvariant\s*=\s*"([^"]*)"/.exec(tag)?.[1] ?? '';
      const whole = wholeName(item.html, at, name);
      if (whole && !tag.endsWith('/>') && (variant === undefined || named === variant)) {
        const close = closeOfCall(item.html, name, openEnd + 1);
        if (close !== -1) return item.html.slice(openEnd + 1, close);
      }
      at = item.html.indexOf(`<x-${name}`, at + 1);
    }
  }
  return undefined;
}

/** Is the `<x-…` at `at` this item, rather than one whose name merely starts
 *  with it?
 *
 *  `<x-status` also begins `<x-status-note`, and — the case that actually bit —
 *  a one-letter item called `f` begins `<x-fill`, which is not a call at all but
 *  the composer's own tag. Counting those as nested calls left `f` with no
 *  sample in the kit and four empty boxes on the sheet. The character after the
 *  name is what tells them apart. */
function wholeName(html: string, at: number, name: ItemName): boolean {
  const after = html[at + name.length + 3] ?? '';
  return after === '>' || after === ' ' || after === '/';
}

/** Where this call ends, counting nested calls of the same item. */
function closeOfCall(html: string, name: ItemName, from: number): number {
  let depth = 0;
  let at = from;

  for (;;) {
    const open = html.indexOf(`<x-${name}`, at);
    const close = html.indexOf(`</x-${name}>`, at);
    if (close === -1) return -1;

    if (open !== -1 && open < close) {
      if (wholeName(html, open, name)) {
        const tag = html.slice(open, html.indexOf('>', open) + 1);
        if (!tag.endsWith('/>')) depth += 1;
      }
      at = open + 1;
      continue;
    }
    if (depth === 0) return close;
    depth -= 1;
    at = close + 1;
  }
}

/** The columns one item gets: the bare reference, then every variant it
 *  declares.
 *
 *  Except the one the bare reference already is. A component whose default is
 *  `blue` would otherwise show blue twice, in two cells captioned differently
 *  — which reads as two things that happen to look alike. */
function columnsOf(item: Item): { variant: string; label: string }[] {
  const declared = Object.keys(item.variants ?? {});
  const base = item.defaultVariant;

  return [
    { variant: '', label: base ? `default = ${base}` : 'default' },
    ...declared.filter((name) => name !== base).map((name) => ({ variant: name, label: name })),
  ];
}

/* ── shell and styles ───────────────────────────────────────────────────── */

function page(title: string, note: string, body: string): string {
  return `<main class="kit">
  <header class="kit__head">
    <h1>${esc(title)}</h1>
    <p class="kit-note">${esc(note)}</p>
  </header>
  ${body}
  <footer class="kit__foot">Generated from the registry — build_kit rewrites it.</footer>
</main>`;
}

/** The kit pages' own layout. Written in tokens where the project has them,
 *  with fallbacks so a project that names its tokens differently still gets a
 *  readable page rather than a broken one. */
export function kitSheet(): string {
  return `/* A ground of its own, and deliberately neither the design's dark nor white:
   a dark part on a dark sheet and a light part on a light one both disappear
   into it, and half of what a kit is for is seeing the edges of things. A mid
   grey is a poor background for nothing in particular, which is what makes it
   a good one here — and it says at a glance that this screen is the kit
   rather than the product. */
.kit {
  --kit-ground: #9aa0ab;
  --kit-ink: #14171d;
  --kit-ink-soft: #3b414d;
  --kit-rule: rgba(0, 0, 0, 0.22);

  display: flex;
  flex-direction: column;
  gap: var(--space-6, 32px);
  padding: var(--space-6, 32px);
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--kit-ink);
  background: var(--kit-ground);
  /* The ground reaches the bottom of whatever it is drawn in.
     A sheet stores ONE height, and its parts are now drawn in windows at the
     viewport being looked at — so the sheet is a few hundred pixels shorter on
     a phone than the size it was measured at. Without this that difference was
     a band of the design's own black under the page, which reads as a bug in
     the sheet rather than as slack. */
  min-height: 100dvh;
  /* No 100vh: a sheet measures itself and the frame is its own height, so a
     minimum in viewport units would only stretch it to whatever the browser
     happened to be when it was measured. */
}

.kit__head h1 {
  margin: 0;
  font-size: var(--text-2xl, 1.75rem);
}

.kit-note,
.kit-value,
.kit-desc,
.kit-tier {
  color: var(--kit-ink-soft);
  font-size: var(--text-sm, 0.875rem);
}

.kit code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-sm, 0.8125rem);
}

.kit__foot {
  margin-top: auto;
  padding-top: var(--space-5, 24px);
  border-top: 1px solid var(--kit-rule);
  color: var(--kit-ink-soft);
  font-size: var(--text-xs, 0.75rem);
}

.kit-swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-4, 16px);
}

.kit-swatch {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
}

.kit-chip {
  height: 64px;
  border-radius: var(--radius-md, 10px);
  border: 1px solid var(--kit-rule);
}

.kit-swatch figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kit-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}

.kit-row {
  display: grid;
  grid-template-columns: 12rem 1fr 6rem;
  align-items: center;
  gap: var(--space-4, 16px);
}

/* The sample is about the FACE and its size — colour is the swatches' job —
   so it is read in the sheet's own ink rather than the design's. */
.kit-sample {
  color: var(--kit-ink);
}

.kit-bar {
  height: 12px;
  min-width: 2px;
  /* A size token can be wider than the page it is drawn on — --shell-max is
   * 1440px, the kit sheet is not much wider — and an uncapped bar pushed its
   * own "1440px" caption off the right edge, the one token whose value you
   * then could not read. Cap it; the caption carries the true number. */
  max-width: 100%;
  border-radius: 2px;
  background: var(--accent, #4f7cf7);
}

.kit-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-2, 8px);
}

.kit-list > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3, 12px);
  padding: var(--space-2, 8px) 0;
  border-bottom: 1px solid var(--kit-rule);
}

.kit-part {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
  padding-top: var(--space-4, 16px);
  border-top: 1px solid var(--kit-rule);
}

.kit-part__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3, 12px);
  flex-wrap: wrap;
}

.kit-variants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4, 16px);
}

.kit-variant {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
}

.kit-variant figcaption {
  color: var(--kit-ink-soft);
  font-size: var(--text-xs, 0.75rem);
}

.kit-icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--space-3, 12px);
}

.kit-icon {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2, 8px);
}

/* Stroke by default — see iconsSection. */
.kit-glyph {
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kit-icons--fill .kit-glyph {
  fill: currentColor;
  stroke: none;
}

/* The parts themselves are drawn on the DESIGN's ground, not the sheet's: an
   icon meant for a dark app is invisible on grey, and what a kit has to show
   is the thing as it really looks. The grey is around them, not under them. */
.kit-icon__stage {
  width: 100%;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--kit-rule);
  border-radius: var(--radius-md, 10px);
  /* Self-contained, NOT the design's --bg/--text. Those names belong to the
   * starter kit's vocabulary; a project that brings its own leaves --text
   * undefined, the fallback was near-white, and an icon came out light on a
   * light --bg — invisible. The kit's own ink on a plain white chip is legible
   * whatever a design calls its tokens. (A theme-specific icon still wants
   * rendering in the design's own context, the way components already are — a
   * later change; this only stops the disappearing act.) */
  background: #fff;
  color: var(--kit-ink);
}

.kit-icon figcaption {
  color: var(--kit-ink-soft);
  font-size: var(--text-xs, 0.75rem);
  text-align: center;
  /* A name like icon-check:default is longer than its cell, and a grid that
     stretches to its longest caption stops being a grid. */
  overflow-wrap: anywhere;
}

/* A region of a layout has no appearance of its own, so the sheet gives it a
   dashed outline and its name — and NOTHING ELSE. No size, no position: those
   belong to the region it was poured into, and a label that laid itself out
   would be showing the label's arrangement rather than the layout's. */
.kit-region {
  padding: var(--space-2, 8px);
  border: 1px dashed currentcolor;
  border-radius: var(--radius-sm, 6px);
  color: var(--text-muted, #8b93a7);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 0.75rem);
  text-align: center;
}

/* The body region is the one that takes the space left over, so its label
   fills what it was given rather than sitting at the top of it. */
.kit-page main > .kit-region {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Shells sit side by side, one per viewport, and are read left to right. */
.kit-part--layout .kit-variants {
  align-items: flex-start;
  gap: var(--space-6, 32px);
}

/* A shell is shown in a frame of its own — see layoutRow. The frame is drawn
   at the viewport's real width and scaled down to fit the sheet, so what it
   lays out is what that viewport gets. */
/* Two classes deep on purpose: .kit-stage comes later in this sheet and would
   otherwise win on source order and centre the frame again. */
.kit-stage.kit-stage--frame {
  /* Top left, not centred. A cell centres what is in it, and a frame is BIGGER
     than its cell — it is 1440 wide and scaled down to fit — so centring the
     layout box put it 130px to the left and 56px above the cell, with the
     header clipped away by the overflow. */
  align-items: flex-start;
  justify-content: flex-start;
  overflow: hidden;
  border: 0;
  padding: 0;
  background: none;
  min-width: 0;
  min-height: 0;
}

/* A PART keeps the card this sheet has always drawn — the design's ground, a
   hairline, and air around it — and the window it is really drawn in becomes
   invisible inside that card.

   Which is the whole trick: the air cannot go INSIDE the frame, because a
   message band bleeds to the width of what contains it and padding there would
   stop it. So it goes outside, on the card, and the crop sits between them. Put
   the border on the frame instead and it hugs the part — a send button came out
   as a circle in a 48px box with a line drawn tight around it. */
.kit-crop {
  overflow: hidden;
  /* An iframe is inline, and an inline box sits on the baseline with a few
     pixels of descender space under it. */
  line-height: 0;
}

.kit-stage--part .kit-frame {
  display: block;
  border: 0;
  border-radius: 0;
  background: none;
}

.kit-frame {
  /* The frame carries its own document, so the design's ground is inside it
     and the sheet's grey stops at its border. */
  /* Never shrunk to the cell: a frame is a WINDOW, and its width is what the
     design's media queries answer to. As a flex item it shrank from 1440 to
     the 1180 the sheet had room for, and the shell inside laid itself out with
     the phone rules — the one thing this frame exists to avoid. */
  flex: none;
  border: 1px solid var(--border, #2b303b);
  border-radius: var(--radius-lg, 18px);
  transform-origin: top left;
  background: var(--bg, #0f1116);
}

/* A part is drawn on the DESIGN's ground, inside the sheet's grey — that is
   what puts an edge around it. Centred, so a row of variants lines up. */
/* A part frame holds one part, not a page. It keeps the design's page class —
   that is where the typeface, the ink and the ground come from, and without it
   every part renders in Times on white — and gives up only the page GEOMETRY:
   a full-height flex column that becomes a grid at 1200px would make a chip as
   tall as a phone and auto-place it into a cell it never asked for.

   Written with the element on purpose. A bare .kit-part-page ties with .app on
   specificity, and the tie would be settled by whichever stylesheet the
   composer happened to put last — including the one that turns .app into a
   grid inside a media query, which is the case that matters. One extra element
   in the selector settles it instead.

   No padding: a client's message band bleeds to the width of what contains it,
   and padding here would quietly stop it doing that. */
/* Block flow, so a band is as wide as what contains it and a pill is as wide
   as its words — the same two answers the design gives. Making this a flex
   column was tried, to give an inline pip a box, and it cost the other half:
   with flex-start every full-width block shrank to its content, and the order
   strip cropped its own status pill off the right. The pip is fixed where the
   pip is the problem — see the fit script. */
body.kit-part-page {
  margin: 0;
  display: block;
  height: auto;
  min-height: 0;
  overflow: visible;
}

.kit-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 140px;
  min-height: 72px;
  padding: var(--space-3, 12px);
  border: 1px solid var(--kit-rule);
  border-radius: var(--radius-md, 10px);
  background: var(--bg, #0f1116);
  color: var(--text, #e6e8ee);
}`;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
