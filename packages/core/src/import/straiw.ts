/* Build a ProjectDoc from a STRAIW-shaped design folder.
 *
 * Pure: the caller does the file reading and hands in strings, so this runs
 * in a test, in the CLI and (later) in a browser drop-target with no change.
 *
 * Screens come in OPAQUE — markup verbatim, nothing decomposed. That is a
 * legal state, not a temporary sin: an item whose html contains no `<x-*>` is
 * simply an item that composes nothing. Extraction happens later, one item at
 * a time, gated on the render staying pixel-identical.
 */

import { arrange } from '../flow/arrange';
import { inferEdges } from '../flow/connect';
import { extractStrings } from '../strings/extract';
import type {
  Asset,
  Flow,
  FlowGroup,
  FlowNode,
  FontFace,
  Item,
  ItemName,
  Locale,
  ProjectDoc,
  Theme,
  Viewport,
} from '../types/project';
import { DEFAULT_VIEWPORTS } from '../types/project';
import { parseAttrs } from './attrs';
import { tokenAtRules, tokensUnder } from './css-tokens';
import { pageParts, sheetName } from './html-parts';

export interface SourceScreen {
  /** File basename without extension, e.g. `01-first-run`. Becomes the item name. */
  name: string;
  html: string;
  /** Which named flow it belongs to, if known. */
  group?: string;
  /** Position within that flow, from the design's own metadata. */
  order?: number;
  /** Human title shown above the node. */
  title?: string;
  /** Caption shown under the node. */
  description?: string;
}

export interface ImportInput {
  projectName: string;
  screens: readonly SourceScreen[];
  /** Stylesheet contents by basename: `{ tokens: '…', chat: '…' }`. */
  css: Readonly<Record<string, string>>;
  groups?: readonly FlowGroup[];
  /** Sheets that are global rather than per-screen. Their rules apply to every
   *  screen, so they belong in `kit.base` instead of `kit.sheets`. */
  baseSheets?: readonly string[];
  /** Injected rather than called directly: core has no `Date` or `crypto` in
   *  its type environment by design, and a test that pins both gets a
   *  byte-stable document to compare against. */
  now?: () => string;
  newId?: () => string;
  /** Defaults to DEFAULT_VIEWPORTS; the first one is what layout is sized for. */
  viewports?: readonly Viewport[];
  /** Overlay locales, merged alongside the extracted default. */
  locales?: Readonly<Record<string, Locale>>;
  /** Webfonts, with their bytes already in `assets`. Fetched host-side. */
  fonts?: readonly FontFace[];
  assets?: Readonly<Record<string, Asset>>;
}

const DEFAULT_BASE_SHEETS = ['base'];

export function importStraiw(input: ImportInput): ProjectDoc {
  const now = (input.now ?? (() => ''))();
  const baseSheets = new Set(input.baseSheets ?? DEFAULT_BASE_SHEETS);

  const items: Record<ItemName, Item> = {};
  const nodes: Record<string, FlowNode> = {};
  const usedSheets = new Set<string>();
  const entries: Record<string, string> = {};
  let keyed = 0;

  for (const screen of input.screens) {
    const parts = pageParts(screen.html);
    const sheets = parts.sheets
      .map(sheetName)
      // tokens become themes and the base sheets become kit.base, so neither
      // is a per-item dependency.
      .filter((name) => name !== 'tokens' && !baseSheets.has(name));
    for (const name of sheets) usedSheets.add(name);

    const rootAttrs = parseAttrs(parts.bodyAttrs);
    const text = extractStrings(parts.body, screen.name);
    Object.assign(entries, text.entries);
    keyed += text.keyed;

    items[screen.name] = {
      tier: 'screen',
      html: text.html,
      // The body's own attributes, kept as attributes OF THE BODY. They select
      // whole screen states — `body[data-spec='closed'] .spec { display: none }`
      // — so moving them to a wrapper div stops the rules matching and the
      // brief panel renders open on every screen that should have it shut.
      ...(Object.keys(rootAttrs).length > 0 ? { rootAttrs } : {}),
      props: {},
      fixtures: { default: { values: {} } },
      ...(sheets.length > 0 ? { sheets } : {}),
      ...(parts.title ? { description: parts.title } : {}),
    };

    nodes[screen.name] = makeNode(screen);
  }

  return {
    schema: 1,
    id: (input.newId ?? (() => slug(input.projectName)))(),
    name: input.projectName,
    createdAt: now,
    updatedAt: now,
    kit: {
      preset: 'none',
      // The responsive type scale lives in @media blocks in tokens.css and
      // cannot be expressed by a flat theme map, so it is carried through as
      // CSS. It goes FIRST in base, which puts it after the theme's :root in
      // the composed document — exactly where the original had it.
      base: [tokenAtRules(input.css.tokens ?? '').join('\n\n')]
        .concat([...baseSheets].map((n) => input.css[n] ?? ''))
        .filter(Boolean)
        .join('\n\n'),
      sheets: pick(input.css, usedSheets),
      themes: themesFrom(input.css.tokens ?? ''),
      defaultTheme: 'dark',
      fonts: [...(input.fonts ?? [])],
    },
    items,
    flow: buildFlow(nodes, input.groups ?? []),
    strings: {
      defaultLocale: 'en',
      locales: {
        en: { label: 'English', entries },
        ...(input.locales ?? {}),
      },
    },
    assets: { ...(input.assets ?? {}) },
    viewports: [...(input.viewports ?? DEFAULT_VIEWPORTS)],
  };
}

/** No cell yet: placement comes from `buildFlow` once the connections exist,
 *  because the arrangement follows the graph. Import only has to produce a
 *  node that carries its order, group and captions. */
function makeNode(screen: SourceScreen): FlowNode {
  return {
    screen: screen.name,
    fixture: 'default',
    title: screen.title ?? screen.name,
    ...(screen.order !== undefined ? { order: screen.order } : {}),
    ...(screen.group ? { groups: [screen.group] } : {}),
    ...(screen.description ? { description: screen.description } : {}),
  };
}

/** Nodes get their real positions here, and the flows get their default
 *  sequential connections, so an imported project opens as readable journeys
 *  rather than an unconnected grid. */
function buildFlow(nodes: Record<string, FlowNode>, groups: readonly FlowGroup[]): Flow {
  const flow: Flow = { nodes, edges: {}, groups: [...groups] };

  // Connections first: the arrangement follows the graph, so it has to exist
  // before anything can be placed by it.
  flow.edges = inferEdges(flow);

  // The happy path then reads left to right along one lane, and a branch drops
  // to the lane below. Grid units, so the same placement holds at every
  // viewport the project is reviewed at.
  for (const [id, cell] of Object.entries(arrange(flow))) {
    const node = flow.nodes[id];
    if (node) {
      node.col = cell.col;
      node.lane = cell.lane;
    }
  }
  return flow;
}

/** STRAIW declares the dark palette on `:root` and overrides a subset under
 *  `[data-theme="light"]`.
 *
 *  Our schema wants every theme to carry a COMPLETE map, so light is built as
 *  dark-then-overridden. That is what makes "a token missing from one theme"
 *  a checkable condition rather than a bug someone notices in a screenshot. */
function themesFrom(tokensCss: string): Record<string, Theme> {
  const dark = tokensUnder(tokensCss, ':root');
  const lightOverrides = tokensUnder(tokensCss, '[data-theme=light]');
  return {
    dark: { label: 'Dark', tokens: dark },
    light: { label: 'Light', tokens: { ...dark, ...lightOverrides } },
  };
}

function pick(all: Readonly<Record<string, string>>, names: ReadonlySet<string>) {
  const out: Record<string, string> = {};
  for (const name of names) {
    const css = all[name];
    if (css) out[name] = css;
  }
  return out;
}

/** Fallback id when the host supplies none. Deterministic, so re-importing the
 *  same folder yields the same document rather than a gratuitous diff. */
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
