/* @flowkit/core — the document, the write surface, and the pure logic
 * that operates on both.
 *
 * Imports nothing from Node and nothing from the DOM. That is enforced two
 * ways: this package compiles with `lib: ["es2023"]` and no "dom", so DOM
 * globals do not typecheck; and tests/purity.test.ts fails on a `node:`
 * import. Everything environment-specific enters through a port in ./ports.
 */

export { apply, applyAll, reducers, validate } from './apply/apply';
export { diagnostic, nearest, unknown } from './apply/diagnostics';
export {
  coverage,
  getItem,
  listEdges,
  listItems,
  listNodes,
  projectCoverage,
} from './apply/queries';
export type { Cell, Grid, Placement } from './flow/arrange';
export { arrange, GRID, placementOf, SNAP, stepOf, toCell, toPoint } from './flow/arrange';
export { inferEdges, sequentialEdges } from './flow/connect';
export type { ElementText, TextSpan } from './html/scan';
export { hasVisibleText, scanText } from './html/scan';
export { parseAttrs } from './import/attrs';
export { splitAtRules, tokenAtRules, tokensUnder } from './import/css-tokens';
export type { PageParts } from './import/html-parts';
export { pageParts, sheetName } from './import/html-parts';
export type { ImportInput, SourceScreen } from './import/straiw';
export { importStraiw } from './import/straiw';
export type { FlowMeta, ScreenMeta } from './import/straiw-index';
export { parseFlows, parseScreens } from './import/straiw-index';
export type { KitPage } from './kits/page';
export {
  isKit,
  KIT_GENERATOR,
  KIT_GROUP,
  KIT_PREFIX,
  KIT_SHEET,
  kitPages,
  kitSheet,
  registryItems,
  sheetWidth,
  staleKitPages,
} from './kits/page';
export type { KitId, StarterContent } from './kits/starter';
export { blankContent, KITS, starterContent } from './kits/starter';
export {
  fingerprint,
  TAILWIND_DEFAULT_INPUT,
  TAILWIND_INPUT,
  TAILWIND_SHEET,
  tailwindBuild,
  tailwindCandidates,
  tailwindHeader,
  tailwindItems,
  tailwindStale,
  tailwindStamp,
} from './kits/tailwind';
export type { ElementNode, HtmlParser, HtmlSerializer, Node, TextNode } from './ports/html-parser';
export type { Composed, ComposeInput } from './render/compose';
export { composeDocument, composeStylesheet } from './render/compose';
export { fontCss, themeCss } from './render/css';
export type { Expansion, ExpansionProblem } from './render/expand';
export { addClass, expand, setAttrs, withoutClass } from './render/expand';
export { rendered } from './render/rendered';
export type { Shape, ShapeMatch } from './render/shape';
export { matchShape, parseShape, unbalanced } from './render/shape';
export { EMBEDDED_DOC_ID } from './render/snapshot';
export { IMPORT, NONE, PHASE_1, run } from './rules';
export type { SpecOptions } from './spec/write';
export { writeSpec } from './spec/write';
export type { Extraction } from './strings/extract';
export { applyStrings, extractStrings } from './strings/extract';
export type {
  ParsedStrings,
  StringFormat,
  StringUnit,
  StringUse,
  UnitOptions,
  WriteOptions,
} from './strings/files';
export { parseStrings, stringUnits, writeStrings } from './strings/files';
export type { Attribution, LeftBehind, Move } from './styles/attribute';
export { attributeCss, prefixOf, screenUse } from './styles/attribute';
export type { CssRule } from './styles/rules';
export { claims, contextClasses, splitRules, subjectClasses } from './styles/rules';
export type {
  Command,
  CommandResult,
  Diagnostic,
  DiagnosticCode,
  ItemSummary,
} from './types/commands';
export type {
  Asset,
  AssetId,
  EdgeId,
  EdgeStyle,
  Fixture,
  FixtureName,
  Flow,
  FlowEdge,
  FlowGroup,
  FlowNode,
  FontFace,
  Item,
  ItemName,
  Kit,
  Locale,
  LocaleId,
  NodeId,
  ProjectDoc,
  PropSpec,
  RenderContext,
  SlotFill,
  Strings,
  Theme,
  ThemeId,
  Tier,
  Variant,
  Viewport,
} from './types/project';
export { DEFAULT_VIEWPORTS, isOpaque, markupOf, markups, TIER_RANK } from './types/project';
export type { ApplyOptions, Domain, DomainReducer, OpLogEntry, Reduction } from './types/reducers';
export type { Rule, RuleScope, RuleSet } from './types/rules';
