/* ─────────────────────────────────────────────────────────────────────────
   Flowkit — the command layer.

   This is the ONLY way a document changes. UI panels, the MCP server and (
   later) the in-app agent all dispatch the same commands; there is no
   write_file, no direct mutation, no second path. That is what makes the
   contract enforceable rather than aspirational: every write goes through one
   validator, and the LLM cannot route around it because no other door exists.

   Three consequences fall out for free:
     · undo/redo      — every command returns its inverse
     · audit          — the op-log is the history of the project
     · collaboration  — later, ordering the ops is the whole problem

   A rejected command is a TEACHING moment, not an error string. Diagnostics
   name what was wrong, what is available, and the nearest valid alternative,
   so a model corrects itself inside the same loop instead of guessing.
   ───────────────────────────────────────────────────────────────────────── */

import type {
  Asset,
  AssetId,
  EdgeId,
  EdgeStyle,
  Fixture,
  FixtureName,
  FlowEdge,
  FlowGroup,
  FlowNode,
  Item,
  ItemName,
  LocaleId,
  NodeId,
  ProjectDoc,
  PropSpec,
  Theme,
  ThemeId,
  Tier,
  Variant,
  Viewport,
} from './project';

/* ── commands ──────────────────────────────────────────────────────────── */

/** A node patch may name a key with `undefined` to clear it — distinct from
 *  omitting the key, which leaves it alone. */
export type NodePatch = { [K in keyof FlowNode]?: FlowNode[K] | undefined };

export type Command =
  // project
  | { t: 'project.rename'; name: string }
  | { t: 'viewport.set'; viewport: Viewport }
  | { t: 'viewport.delete'; id: string }

  // items — `item.setHtml` is the coarse write (sketch a screen, try a
  // variant); the rest are surgical. They are two granularities of the same
  // thing, not two modes, and both remain available permanently.
  | { t: 'item.create'; name: ItemName; tier: Tier; html?: string; description?: string }
  | { t: 'item.setHtml'; name: ItemName; html: string }
  /** Create-or-replace, whole. Exists because it is the only honest inverse of
   *  a partial edit: rebuilding an item from `item.create` + a stream of
   *  setters fails the moment the item still exists, and merging a partial
   *  cannot remove a field the edit added. */
  | { t: 'item.replace'; name: ItemName; item: Item }
  | { t: 'item.setCss'; name: ItemName; css: string; cssPrefix?: string }
  | { t: 'item.setProp'; name: ItemName; prop: string; spec: PropSpec }
  /** Naming a field as `undefined` clears it; omitting it leaves it alone —
   *  the same rule NodePatch states, and the reason this cannot be a plain
   *  optional: under exactOptionalPropertyTypes there is otherwise no way to
   *  say "remove this" at all. */
  | {
      t: 'item.setMeta';
      name: ItemName;
      description?: string | undefined;
      viewport?: string | undefined;
      meta?: Record<string, unknown> | undefined;
      /** Move an item between tiers after it exists — the choice made at
       *  extract time turned out wrong. Safe for references (`<x-name>` does
       *  not name a tier); a change that would dangle a node (a screen made
       *  into a component while a node points at it) is rejected by the rules. */
      tier?: Tier | undefined;
    }
  | { t: 'item.rename'; from: ItemName; to: ItemName }
  | { t: 'item.delete'; name: ItemName }

  /** A named alternative of a component, chosen at a call site by name.
   *
   *  Here rather than in the markup that uses it: the set has to be closed to
   *  be enumerable, and a kit page that lists what exists is only possible if
   *  nothing can invent a variant in passing. */
  | { t: 'item.setVariant'; name: ItemName; variant: string; value: Variant }
  | { t: 'item.deleteVariant'; name: ItemName; variant: string }
  /** Which variant a bare reference means. `null` goes back to the base. */
  | { t: 'item.setDefaultVariant'; name: ItemName; variant: string | null }
  /** The picture a screen stands in as, until it has markup. `null` clears it. */
  | { t: 'item.setImage'; name: ItemName; asset: AssetId | null }
  /** How big this screen is when it is not any viewport. `null` clears it. */
  | { t: 'item.setSize'; name: ItemName; size: { width: number; height: number } | null }
  /** The attributes this item's own `<body>` carries when it is composed as a
   *  document. `null` clears them. */
  | { t: 'item.setRoot'; name: ItemName; attrs: Record<string, string> | null }

  // fixtures
  | { t: 'fixture.set'; item: ItemName; fixture: FixtureName; value: Fixture }
  | { t: 'fixture.delete'; item: ItemName; fixture: FixtureName }

  // flow
  | { t: 'node.add'; id?: NodeId; node: FlowNode }
  | { t: 'node.update'; id: NodeId; patch: NodePatch }
  | { t: 'node.delete'; id: NodeId }
  | { t: 'edge.connect'; id?: EdgeId; from: NodeId; to: NodeId; label?: string; style?: EdgeStyle }
  /** Naming a field as `undefined` clears it; omitting it leaves it alone. */
  | { t: 'edge.update'; id: EdgeId; label?: string | undefined; style?: EdgeStyle | undefined }
  | { t: 'edge.delete'; id: EdgeId }
  | { t: 'group.set'; group: FlowGroup }
  | { t: 'group.delete'; id: string }
  /** Re-place every node from the graph, discarding hand placement. The
   *  "we made a mess" command — one undo step puts it all back. Scope it to
   *  one flow to leave the rest of the canvas alone.
   *
   *  Name a viewport and the arrangement is stored for that one, leaving the
   *  others as they were; omit it and the shared placement is rewritten AND
   *  every per-viewport override in scope is dropped. The second is what "the
   *  way back from a mess" has to mean — a reset that left overrides standing
   *  would put the mess back the moment somebody switched size. */
  | { t: 'flow.arrange'; group?: string; viewport?: string }

  // kit
  | { t: 'kit.setBase'; css: string }
  | { t: 'kit.setPreset'; preset: 'none' | 'tailwind4' }
  /** A named stylesheet shared by several screens.
   *
   *  Not the same thing as an item's own CSS. A rule that belongs to a
   *  component nobody has extracted yet has no item to live on: putting it on
   *  one screen is a lie about who owns it, and copying it into thirty is how
   *  a design system stops being one. A sheet is the honest middle, and
   *  `Item.sheets` is how a screen says it needs one. */
  | { t: 'sheet.set'; name: string; css: string }
  | { t: 'sheet.delete'; name: string }
  | { t: 'theme.set'; id: ThemeId; theme: Theme }
  | { t: 'theme.setToken'; theme: ThemeId; token: string; value: string }
  /** Take a token OUT. Setting it to an empty string is not the same thing:
   *  that leaves the name defined as nothing, which every theme then has to
   *  keep carrying, and `token-not-in-all-themes` reports the theme that
   *  sensibly does not. */
  | { t: 'theme.removeToken'; theme: ThemeId; token: string }
  | { t: 'theme.delete'; id: ThemeId }
  /** Which theme a document renders in when nobody says. */
  | { t: 'kit.setDefaultTheme'; theme: ThemeId }
  | {
      t: 'font.add';
      asset: AssetId;
      family: string;
      weight: string;
      style: 'normal' | 'italic';
      sourceUrl?: string;
      /** Which characters this file covers.
       *
       *  A family arrives as several files — latin, latin-ext, cyrillic — that
       *  differ ONLY by their range, and the browser picks per glyph. Without
       *  this they are indistinguishable, the second replaces the first, and a
       *  language quietly loses its accents while everything still renders. */
      unicodeRange?: string;
    }
  | {
      t: 'font.delete';
      family: string;
      weight: string;
      style: 'normal' | 'italic';
      /** Omit to remove every subset of that face. */
      unicodeRange?: string;
    }

  // strings
  | { t: 'locale.add'; id: LocaleId; label: string }
  | { t: 'locale.delete'; id: LocaleId }
  /** Merges by default — a translator sending twenty keys must not drop the
   *  other two thousand. `replace: true` sets the whole map, which is what an
   *  undo needs: merging the previous entries back cannot remove a key the
   *  original call added. */
  | { t: 'strings.set'; locale: LocaleId; entries: Record<string, string>; replace?: boolean }

  // assets
  | { t: 'asset.add'; id?: AssetId; asset: Asset }
  | { t: 'asset.delete'; id: AssetId };

/* ── result ────────────────────────────────────────────────────────────── */

export interface CommandResult {
  ok: boolean;
  /** The next document. Absent when `ok` is false — a rejected command changes
   *  nothing at all, so there is never a half-applied state to reason about. */
  doc?: ProjectDoc;
  diagnostics: Diagnostic[];
  /** Commands that undo this one. Empty when `ok` is false. */
  inverse: Command[];
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: 'error' | 'warning';
  /** Written to be read by a model as much as a person: say what is wrong and
   *  what to do instead, not just what failed. */
  message: string;
  item?: ItemName;
  node?: NodeId;
  /** 1-indexed line within the item's html or css, when locatable. */
  line?: number;
  /** The nearest valid alternative, when there is one. */
  suggestion?: string;
  /** What WOULD have been accepted here. This is the field that lets a model
   *  fix itself in one step rather than probing. */
  available?: string[];
}

export type DiagnosticCode =
  /* the two axes that exist in phase 1, before any registry ------------- */
  /** A colour written literally instead of through a token. */
  | 'hardcoded-color'
  /** `var(--x)` where `--x` is in no theme. */
  | 'unknown-token'
  /** A theme missing a token the others define. */
  | 'token-not-in-all-themes'
  /** A text node not covered by a `data-t`. */
  | 'untranslated-text'
  /** A `data-t` key with no entry in the default locale. */
  | 'missing-string'

  /* registry and composition — inert until items compose ---------------- */
  | 'unknown-item' // <x-foo> not in the registry
  | 'duplicate-name' // names are unique ACROSS tiers
  | 'tier-violation' // a container inside a component, etc.
  | 'cycle' // A → B → A; caught before it can hang a render
  | 'css-prefix-violation' // selector does not start with the item name
  | 'unknown-slot'
  | 'unknown-prop' // :bind to a prop the parent does not have
  | 'dead-prop' // a spec the template never references
  | 'missing-fixture'
  | 'unknown-fixture'
  | 'unknown-variant' // a default naming a variant the item does not declare
  | 'variant-slots' // a variant's own markup has different slots from the base
  | 'stranded-mockup' // a picture behind markup that now wins, or one that is gone
  | 'unstyled-class' // a class no sheet the item names has ever heard of
  | 'stale-generated' // a generated page or sheet behind what it was made from
  | 'unknown-group'
  | 'unknown-viewport'

  /* structural ---------------------------------------------------------- */
  | 'unknown-node'
  | 'unknown-theme'
  | 'unknown-locale'
  | 'unknown-asset'
  | 'wrong-tier' // node.screen must name a 'screen', not a 'component'
  | 'in-use'; // deleting something still referenced

/* The entry point lives in ./reducers (`apply`, `applyAll`) and the invariants
 * in ./rules — this file is only the vocabulary: what can be asked for, and
 * what comes back. Keeping the shapes here means a reducer can be written and
 * tested against them without importing the pipeline. */

/* ── queries ───────────────────────────────────────────────────────────── */

/* Read-only, so deliberately NOT commands. They are the other half of the MCP
 * surface, and the half that decides token cost: `listItems` returns names and
 * one line each so a model can find what it needs, and only then pays for the
 * full item. Never put the whole registry in a prompt. */

export interface ItemSummary {
  name: ItemName;
  tier: Tier;
  description?: string;
  fixtures: FixtureName[];
  props: string[];
  opaque: boolean;
}
