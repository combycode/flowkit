/* ─────────────────────────────────────────────────────────────────────────
   Flowkit — the project document.  DRAFT FOR REVIEW, nothing depends on
   it yet.

   One document is one project. It is the whole thing: kit, items, flow,
   strings and assets. It serialises to a single JSON file that can be opened,
   saved and shared, and it is the ONLY source of truth — there is no project
   directory and nothing on disk that a tool could edit behind the command
   layer's back.

   Two rules shape almost every decision below:

   1. The record shape is the COMPOSED one from day one, even while phase 1
      only ever populates `html`. An item that is plain HTML today must not
      need a document migration the day it gains children, props or fixtures.

   2. Anything derivable is derived, never stored. Two fields that can
      disagree eventually will. So there is no `isOpaque` flag, no cached
      prop list, no stored thumbnail.
   ───────────────────────────────────────────────────────────────────────── */

export type ItemName = string; // globally unique across tiers; the <x-NAME> tag
export type NodeId = string;
export type EdgeId = string;
export type ThemeId = string;
export type LocaleId = string;
export type AssetId = string;
export type FixtureName = string;

/* ── document ──────────────────────────────────────────────────────────── */

export interface ProjectDoc {
  /** Bumped only for a breaking change; the loader migrates forward. */
  schema: 1;
  id: string;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string;

  kit: Kit;
  /** Keyed by item name. The key IS the name, so an item carries no `name`
   *  field — one place for it means the two can never disagree. */
  items: Record<ItemName, Item>;
  flow: Flow;
  strings: Strings;
  assets: Record<AssetId, Asset>;

  /** The sizes screens may be reviewed at. A node PICKS one from this list —
   *  it is a render-time switch like theme and locale, not a reason to make a
   *  second node. Free-form sizes are a later feature; until then the list is
   *  the vocabulary, which also keeps exports predictable. */
  viewports: Viewport[];
}

export interface Viewport {
  id: string;
  label: string;
  device: 'mobile' | 'desktop';
  width: number;
  height: number;
}

/** What this project starts with — the two sizes the STRAIW design is actually
 *  reviewed and exported at (tools/export.mjs SIZES). */
export const DEFAULT_VIEWPORTS: Viewport[] = [
  { id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 },
  { id: 'desktop', label: 'Desktop', device: 'desktop', width: 1440, height: 900 },
];

/* ── kit: the styling substrate ────────────────────────────────────────── */

export interface Kit {
  /** 'none' is plain CSS over the project's own tokens; 'tailwind4' compiles a
   *  utility layer from the classes the items use. Either way a preset only ever
   *  supplies base and utilities INSIDE item CSS — screens always use item
   *  classes, or component export has nothing to export. */
  preset: 'none' | 'tailwind4';

  /** Reset and element defaults. Applies to every composed document, before
   *  any item CSS. */
  base: string;

  /** Named stylesheets not yet attributed to any item — what an import starts
   *  with, and what decomposition drains.
   *
   *  STRAIW links `chat.css`, `cabinet.css`, `admin.css` and so on from many
   *  screens each. That CSS belongs to components that do not exist yet, so
   *  putting it on an item would be a lie and duplicating it across thirty
   *  screens would be worse. A sheet is the honest middle: shared, deduped,
   *  and referenced by `Item.sheets`.
   *
   *  As items are extracted, rules move from a sheet into the item that owns
   *  them, and `coverage` measures the progress. An empty `sheets` means the
   *  project is fully attributed. */
  sheets: Record<string, string>;

  themes: Record<ThemeId, Theme>;
  defaultTheme: ThemeId;

  fonts: FontFace[];
}

export interface Theme {
  label: string;
  /** Custom property name INCLUDING the leading `--`, e.g. '--bg'. Stored
   *  literally so validation is set membership and CSS is greppable with no
   *  transformation step.
   *
   *  Every theme carries a COMPLETE map, not a diff over a base theme. The
   *  duplication is deliberate: a token that exists in one theme and not
   *  another is the single most common theming bug, and whole-map equality is
   *  trivially checkable (validator: all themes define the same key set). */
  tokens: Record<string, string>;
}

export interface FontFace {
  family: string;
  weight: string; // '400', or '400 800' for a variable face
  style: 'normal' | 'italic';
  /** Bytes live in the document — offline-first, and a shared project must
   *  render with no network. */
  asset: AssetId;
  /** Preserved so export can offer `fonts: inline | cdn` rather than guessing
   *  where the face came from. */
  sourceUrl?: string;
  unicodeRange?: string;
}

/* ── items: the registry ───────────────────────────────────────────────── */

/** Router → Layout + settings → Screen → Container → Component → Element.
 *
 *  element    atoms — button, link, input. PROJECT-AGNOSTIC and reusable in
 *             any project; this tier plus the tokens is what "copy the design
 *             system from another project" actually copies.
 *  component  a complete piece of UI — section, form. Static template, props
 *             only, no business logic. Internal state only for RENDERING
 *             (fold, lazy scroll, editable flag).
 *  container  business logic, wires components through props. Never touches
 *             external services or an API.
 *  layout     the shell a screen is poured into: which regions exist and in
 *             what order, as slots. Several per project.
 *  screen     a navigation unit — page, modal, subroute. Self-contained and
 *             owns its data source. Props are configuration only.
 *
 *  The validator enforces one rule that does most of the work:
 *  tierRank(child) < tierRank(parent).
 *
 *  A LAYOUT RANKS BELOW A SCREEN, which is the whole shape of the model: a
 *  screen is the only thing nothing contains, and what it contains first is
 *  its layout — `<x-app-shell>` with a fill per region. Ranking the layout
 *  above the screen said the opposite, that a layout contains screens, and
 *  then a screen could not name the shell it is poured into. */
export type Tier = 'element' | 'component' | 'container' | 'screen' | 'layout';

export const TIER_RANK: Record<Tier, number> = {
  element: 0,
  component: 1,
  container: 2,
  layout: 3,
  screen: 4,
};

export interface Item {
  tier: Tier;

  /** The template. Three composer constructs, and no more:
   *
   *    <x-button variant="quiet"/>         use a registry item (optionally a variant)
   *    <x-slot name="body"/>               a hole this item declares
   *    <x-fill slot="body">…</x-fill>      fill one of a called item's holes
   *
   *  A variant is a NAMED alternative declared in the registry (a class, some
   *  attributes, or its own markup), chosen at the call site with `variant=`.
   *
   *  No interpolation, no conditions, no loops — see the composer's own note in
   *  render/expand.ts. Sixty-two real screens were measured before this was
   *  drawn and not one is data-driven: rows are drawn, not looped, and text
   *  stays text so extraction moves strings rather than rewriting them. Anything
   *  that varies is a variant, a fill, or a separate screen — never an
   *  expression in the markup.
   *
   *  `<x-*>` parses natively with DOMParser (unknown tags are legal HTML), so
   *  there is no template parser to write and no dependency to add.
   *
   *  An item whose html contains no `<x-` is OPAQUE. That is DERIVED, never
   *  stored and never a project-level mode: a project may hold any mix, and
   *  imported screens start fully opaque. */
  html: string;

  /** This item's styles, defined exactly once. Composing a screen collects the
   *  CSS of every item in the tree, deduped by name — which is what makes the
   *  kit unable to drift from the screens.
   *
   *  Selectors must start with the item's name (`.button`, `.button__label`,
   *  `.button--primary`), enforced by the validator. */
  css?: string;

  /** Alias when selectors legitimately do not match the item name — the
   *  import case: STRAIW's `layout:header` owns `.hdr-*`. Without this the
   *  importer would have to rename real, working classes. */
  cssPrefix?: string;

  /** Shared stylesheets from `Kit.sheets` this item needs, in order. Mirrors
   *  exactly what the source screen's `<link>` tags expressed. Shrinks as CSS
   *  is attributed to items. */
  sheets?: string[];

  /** Attributes for the composed document's `<body>`.
   *
   *  Not cosmetic, and not safe to move onto a wrapper element: STRAIW drives
   *  whole screen states from the body itself —
   *  `body[data-spec='closed'] .spec { display: none }` and `body.app.kb-half`.
   *  Wrapping those attributes in a div stops the rules matching, and the brief
   *  panel then renders OPEN on every screen that should have it shut.
   *
   *  A screen is a document root in phase 1, so it legitimately owns root
   *  attributes; layouts will want the same once they exist. */
  rootAttrs?: Record<string, string>;

  /** Free-form annotations for the values a part expects — a type, a default,
   *  a description — set by hand and surfaced in list_items and the spec. The
   *  composer does not read them (it has no interpolation or binding; see the
   *  html note above), so nothing is derived from the template and nothing
   *  drives rendering from here. Empty for most items. */
  props: Record<string, PropSpec>;

  slots?: string[];

  /** Named alternatives, chosen at the call site with `variant="…"`. Absent
   *  means the item has one appearance. */
  variants?: Record<string, Variant>;

  /** How big this screen is, in CSS pixels, when it is not any viewport.
   *
   *  A generated page is as long as what it shows: a kit sheet of forty
   *  components is four thousand pixels tall, and rendering it in a 900px
   *  frame exports its first screenful with nothing to say the rest was cut.
   *  Its size is MEASURED after it is written rather than chosen from the
   *  viewport list, because no list has the right number in it.
   *
   *  Everything that draws a screen prefers this to the viewport. */
  size?: { width: number; height: number };

  /** Which variant a bare `<x-name/>` means.
   *
   *  Some families have no neutral member. STRAIW's status dot is `dot
   *  dot-blue`, `dot dot-green`, `dot dot-amber` — `dot` on its own is an
   *  invisible circle nobody ever writes. The base markup still has to be
   *  neutral, because a variant ADDS a class and cannot take one away, so the
   *  component says here which of its variants is the ordinary one. */
  defaultVariant?: string;

  /** Named sets of prop values. 'default' is required.
   *
   *  A fixture without props is meaningless, so phase-1 opaque items carry
   *  only `default: { values: {} }`. Once an item has props, fixtures are how
   *  min/max/empty/error variants exist WITHOUT duplicating the item. */
  fixtures: Record<FixtureName, Fixture>;

  description?: string;

  /** A picture standing in for markup — a screen that is still a mockup.
   *
   *  Two things fall out of it, and both were the reason for adding it. A
   *  project can START from what a designer already has: twenty PNGs become
   *  twenty screens on the canvas, connected and annotated, and each is
   *  replaced by real markup when its turn comes rather than all at once. And
   *  a viewer can be built from pictures instead of documents, for the times
   *  when handing over the design does not mean handing over the markup.
   *
   *  The MARKUP WINS as soon as there is any. A screen being converted gets
   *  its html written, rendered and corrected while the picture sits behind
   *  it; if the picture kept winning, the author would write markup, render,
   *  see the mockup, and have no idea why. The leftover is reported rather
   *  than removed — deciding the conversion is finished is not this field's
   *  job. */
  image?: AssetId;

  /** The same free-form record as a node's, for a part rather than a screen.
   *
   *  Where an observation goes before it has a mechanism: what this expects to
   *  be given, how it behaves at another width, what it will be called once
   *  somebody turns this registry into components. Unread by everything here,
   *  and carried into the spec as written. */
  meta?: Record<string, unknown>;

  /** Written by a generator rather than by a person — `build_kit` names itself
   *  here.
   *
   *  It changes how the rest of the system treats the item: its text is not
   *  product copy, so it is not offered for translation and not complained
   *  about for lacking string keys; and it does not belong on a flow map,
   *  which is about journeys. Editing one by hand is pointless, because the
   *  next build overwrites it.
   *
   *  A field rather than a name convention: `kit-` is a prefix somebody will
   *  eventually use for a real screen, and this has to be a fact about the
   *  item rather than a guess from its name. */
  generated?: string;

  /** Screens and layouts only — the size this item is designed at. Falls back
   *  to the project's first viewport. */
  viewport?: string;
}

export interface PropSpec {
  type: 'string' | 'number' | 'boolean' | 'list' | 'object';
  default?: unknown;
  description?: string;
}

/** A named alternative of a component — what a call site asks for by name.
 *
 *  The registry owns the difference; the screen names the intent. That is the
 *  whole point: `<x-field variant="confirmed"/>` cannot be misspelled into a
 *  new variant the way `class="is-confimed"` can, and the set is enumerable,
 *  which is what lets the kit page be generated instead of maintained.
 *
 *  Measured before it was designed: 189 elements in the STRAIW design carry a
 *  modifier class and every one carries exactly one, so a closed list of names
 *  fits what designs actually do — there is no combinatorial explosion to
 *  parameterise around. */
export interface Variant {
  label?: string;
  /** Classes added to the component's ROOT element. */
  class?: string;
  /** Attributes set on the component's ROOT element.
   *
   *  A class is not always what tells two states apart. `.rchip.is-met` goes
   *  with `aria-pressed="true"`, `.spec-tab.is-on` with `aria-selected="true"`,
   *  and the send button's state is `disabled` and nothing else — the design's
   *  own rule is `.comp-send[disabled]`. With only a class to work with, those
   *  three had to stay raw markup on the screens, because a frozen
   *  `aria-pressed="false"` under ten pressed chips is not a simplification,
   *  it is the design saying something untrue. */
  attrs?: Record<string, string>;
  /** Markup of its own, in place of the item's.
   *
   *  The last resort, and a legitimate one: a real component renders different
   *  ELEMENTS in different states, not just different classes — a panel with a
   *  scrim behind it and one without, a row that grows a second line. Splitting
   *  those into two items would say they are two things, and they are not; the
   *  point of keeping them together is that whoever later turns this registry
   *  into components gets one component with its states, rather than a pile of
   *  near-duplicates to recognise as a family.
   *
   *  Inherited when absent, which is the common case: state is usually a class.
   *  An override still takes `class` and `attrs` on top, so a variant can share
   *  the modifier and differ only in structure. */
  html?: string;
  /** Which fixture to render with. Unused until items have props; here so a
   *  variant means one thing at the call site whichever mechanism backs it. */
  fixture?: FixtureName;
  note?: string;
}

export interface Fixture {
  label?: string;
  /** prop name → value */
  values: Record<string, unknown>;
  note?: string;
}

/* ── flow: what sits on the canvas ─────────────────────────────────────── */

export interface Flow {
  nodes: Record<NodeId, FlowNode>;
  edges: Record<EdgeId, FlowEdge>;
  /** Named flows the canvas can filter to — STRAIW already works this way
   *  (briefing / cabinet / review / ops / worker / expert). A tag rather than
   *  separate boards, so a node keeps one position and "show all" is the
   *  natural default rather than a stitched-together view. */
  groups: FlowGroup[];
}

export interface FlowGroup {
  id: string;
  label: string;
  /** Optional one-line description, shown when the filter is active. */
  note?: string;
  /** How its screens are placed when nobody has placed them.
   *
   *  'flow' (the default) follows the connections: the happy path along one
   *  lane, branches below. 'row' lays them side by side, which is what
   *  reference pages want — the kit is not a journey, and stacking its five
   *  pages down the canvas means a picture of it is five screenshots. */
  arrange?: 'flow' | 'row';
}

/** What fills a layout slot. A discriminated union so new kinds can be added
 *  without touching the ones that exist — 'html' is the phase-1 escape hatch
 *  and stays useful for one-off chrome that never earns an item. */
export type SlotFill =
  | { kind: 'screen'; screen: ItemName; fixture?: FixtureName; props?: Record<string, unknown> }
  | { kind: 'item'; item: ItemName; props?: Record<string, unknown> }
  | { kind: 'html'; html: string };

/** A canvas node is not a page — it is Screen ∘ Layout ∘ settings.
 *
 *  Keeping them separate is what makes one header edit update forty screens.
 *  It also means `fixture`, `locale` and `theme` are three ORTHOGONAL
 *  render-time switches: flip any of them and the node re-renders in place. A
 *  second node exists only where the FLOW branches, never to show the same
 *  screen with different data, a different language or a different theme. */
export interface FlowNode {
  /** An item of tier 'screen' — what this node IS in the flow. */
  screen: ItemName;

  /** An item of tier 'layout'. Optional: phase-1 imported screens are whole
   *  pages with their chrome baked in, and gain a layout at C1.
   *
   *  A layout's slots hold screens and navigation containers, so filling them
   *  is a separate concern from its plain values. `screen` above goes into
   *  `screenSlot`; `slots` fills the rest. */
  layout?: ItemName;
  /** Which of the layout's slots receives `screen`. Defaults to 'body'. */
  screenSlot?: string;
  /** Plain values — title, nav link lists, flags. */
  layoutProps?: Record<string, unknown>;
  /** The layout's other slots: sidebar navigation, a header container, a
   *  secondary panel. */
  slots?: Record<string, SlotFill>;

  fixture: FixtureName;
  /** Ad-hoc overrides on top of the fixture, for one-off tweaks that do not
   *  deserve a named fixture. */
  props?: Record<string, unknown>;

  /* WHERE IT SITS, in grid units rather than pixels.
   *
   * One column is a screen width plus the corridor beside it; one lane is a
   * screen height plus the room a title and caption need. Pixels are computed
   * at render time from the viewport actually being shown.
   *
   * Storing pixels does not work: a position measured for a 390px phone puts
   * screens on top of each other at 1440px, so a placement someone made by
   * hand would break the first time they switched size. In grid units the
   * same placement is correct at every viewport.
   *
   * Absent means "not placed yet" — the canvas arranges it from the graph and
   * persists nothing until something is actually moved. */
  col?: number;
  lane?: number;

  /** Placement for one viewport, overriding col/lane there.
   *
   *  Grid units were meant to make one placement correct at every size, and
   *  they are not, because the step is not uniform: a column is a screen width
   *  plus a corridor and a lane is a screen height plus its captions, so going
   *  from a 390x844 phone to a 1440x900 desktop stretches the canvas 2.84x
   *  across and 1.06x down. A layout that reads as a tidy grid on one becomes
   *  three times wider and the same height on the other.
   *
   *  A single lattice sized to the widest viewport fixes the stretch and was
   *  tried: it left phone screens 1440px apart, which is worse. So placement
   *  is per viewport where somebody has made one, and col/lane stays the
   *  default for every viewport nobody has arranged yet. */
  cells?: Record<string, { col: number; lane: number }>;

  /** Which named flows this node belongs to. Empty means it shows only under
   *  "all". A node can sit in more than one — a sign-in screen belongs to
   *  several journeys without being duplicated. */
  groups?: string[];

  /** Position within its flow, 1-based. Distinct from x/y: this is the
   *  designer's statement about sequence, whereas x/y is where it happens to
   *  sit on the canvas. Auto-layout and the default connections both read it,
   *  so the canvas can be rearranged without losing the intended order. */
  order?: number;

  /** Shown above and below the frame on the canvas. */
  title?: string;
  description?: string;

  /** Picks a project viewport by id. A render-time switch alongside theme,
   *  locale and fixture — changing it re-renders in place rather than making
   *  a second node. Falls back to the screen's own, then the first project
   *  viewport. */
  viewport?: string;

  /** RESERVED — a modal screen drawn over its parent rather than beside it.
   *  Agreed in principle, deliberately not implemented yet. Present so that
   *  adding it is a renderer change and not a document migration. */
  over?: NodeId;

  /** Anything else worth recording about this screen, unread by the tool.
   *
   *  Roles allowed here, the endpoints it reads and writes, a ticket, a rule
   *  the screen has to obey. None of it means anything to the renderer, and
   *  that is the point: this is where knowledge lands BEFORE there is a field
   *  for it, and the first place a link to a data model will be written down
   *  while the graph still holds nothing but screens.
   *
   *  Values are arbitrary JSON rather than strings, so a list of endpoints
   *  stays a list instead of becoming a comma-joined line nobody can parse
   *  back. It travels into the exported spec verbatim. */
  meta?: Record<string, unknown>;
}

/** How a connection is drawn.
 *
 *  Presentation, but on a map of sixty screens presentation carries meaning: a
 *  dashed line reads as "sometimes, not always", a thick one as the path most
 *  people take, and a colour separates one journey from another without a
 *  legend anybody has to consult. */
export interface EdgeStyle {
  /** Stroke width in pixels. */
  width?: number;
  /** Any CSS colour.
   *
   *  Deliberately NOT a design token: the canvas is chrome around the design
   *  rather than part of it, and the design's variables are not in scope out
   *  here. A token name written into this would silently resolve to nothing. */
  color?: string;
  /** Dashed rather than solid. */
  dash?: boolean;
}

export interface FlowEdge {
  from: NodeId;
  to: NodeId;
  label?: string;

  /** How to draw it. Absent means the canvas decides. */
  style?: EdgeStyle;

  /** Who drew it. Absent or 'authored' means a person or a model asserted it;
   *  'auto' means the importer guessed from screen order and naming.
   *
   *  The distinction is what makes guessing safe: an auto edge can be drawn
   *  provisionally, replaced wholesale on re-import, and cleared in one
   *  command, while an authored one is never touched. Without it, improving
   *  the guess would mean destroying real work. */
  origin?: 'auto' | 'authored';

  /** RESERVED — element-level anchoring, deliberately unused in phase 1.
   *
   *  Present so that adding it later is not a document migration. When it
   *  arrives it must be an instance-qualified PATH, never a bare data-anchor
   *  value: once items compose, the same anchor appears in every screen that
   *  uses the component, so the attribute alone does not identify anything.
   *  See spikes/spike-a-anchors/RESULTS.md. */
  fromAnchor?: string;
}

/* ── strings ───────────────────────────────────────────────────────────── */

export interface Strings {
  defaultLocale: LocaleId;
  locales: Record<LocaleId, Locale>;
}

export interface Locale {
  label: string;
  /** key → text.
   *
   *  The default locale's text ALSO lives inline in the html, as
   *  `<h1 data-t="auth.title">Sign in</h1>`. That is deliberate: one write per
   *  edit, the template renders correctly with no resolution step, and the key
   *  is present for extraction. Other locales are overlays applied at render.
   *
   *  The validator flags any text node not covered by a `data-t`, which is
   *  what keeps "strings from day one" a real gate rather than an intention. */
  entries: Record<string, string>;
}

/* ── assets ────────────────────────────────────────────────────────────── */

export interface Asset {
  kind: 'font' | 'image' | 'icon';
  mime: string;
  /** base64. Inline because a shared project must render offline. Subset fonts
   *  before adding them — a full variable face is six figures of bytes. */
  bytes: string;
  /** Where it came from, kept so export can offer to link instead of inline. */
  sourceUrl?: string;
  label?: string;
}

/* ── render context ────────────────────────────────────────────────────── */

/** Everything needed to turn a node into a document, and the complete set of
 *  axes a node can be viewed along. */
export interface RenderContext {
  theme: ThemeId;
  locale: LocaleId;
  /** Project viewport id. */
  viewport: string;
  /** Overrides the node's own fixture — for previewing without mutating. */
  fixture?: FixtureName;
}

/* ── derived, never stored ─────────────────────────────────────────────── */

/** An item is opaque when it composes nothing. Cheap to compute, and computing
 *  it removes a flag that could lie. */
export const isOpaque = (item: Item): boolean => !markups(item).some((h) => /<x-[a-z]/i.test(h));

/** The markup one call renders: the variant's own, if it overrides, else the
 *  item's. The single place that answers this, so nothing has to remember that
 *  a variant may bring markup of its own. */
export const markupOf = (item: Item, variant?: string): string =>
  (variant === undefined ? undefined : item.variants?.[variant]?.html) ?? item.html;

/** Every markup an item can render: its own, and any a variant overrides with.
 *
 *  What anything that SCANS an item wants — which classes it uses, which items
 *  it references, which utilities have to be compiled. Reading only `html`
 *  quietly misses whatever exists solely in a state. */
export function markups(item: Item): string[] {
  const out = [item.html];
  for (const variant of Object.values(item.variants ?? {})) {
    if (variant.html !== undefined && variant.html !== item.html) out.push(variant.html);
  }
  return out;
}
