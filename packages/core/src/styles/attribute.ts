/* Moving a rule out of a shared sheet and onto the part it draws.
 *
 * An import arrives as thirty screens linking `chat.css`. That CSS is real and
 * works, but it belongs to nothing: no component owns it, so the design system
 * cannot be carried anywhere. As parts are extracted, their rules can follow
 * them — and this works out which rules those are, and writes the commands
 * that move them.
 *
 * Nothing new is invented to do it. `sheet.set` and `item.setCss` already
 * exist, both write whole values and both have exact inverses, so a move is a
 * pair of ordinary commands and undoes like one edit.
 *
 * WHAT IT WILL NOT DO is decide anything doubtful. A rule whose subject names
 * two parts, or none, stays where it is and is reported. The sheets drain as
 * the design is decomposed, not before — and a rule moved onto the wrong item
 * would be discovered by somebody looking at a screenshot months later.
 */

import { expand } from '../render/expand';
import type { Command } from '../types/commands';
import type { ItemName, ProjectDoc } from '../types/project';
import { type CssRule, claims, splitRules, subjectClasses } from './rules';

export interface Move {
  sheet: string;
  selector: string;
  conditions: string[];
  bytes: number;
}

export type LeftBehind = 'several owners' | 'only the context' | 'screens still use the class';

export interface Attribution {
  /** What to run. Empty when there is nothing to move. */
  commands: Command[];
  moved: Move[];
  /** Rules that mention this part but were left alone, and why. */
  left: { sheet: string; selector: string; why: LeftBehind; screens?: string[] }[];
}

/** Which classes each screen's own markup puts on elements, and which parts it
 *  is composed from.
 *
 *  THE reason CSS cannot simply be moved. A screen only gets a part's CSS if
 *  it composes that part — but an imported design is raw markup writing
 *  `.dot` and `.tag` by hand, with no component anywhere. Move those rules out
 *  of the shared sheet and sixty screens lose their styling in silence: the
 *  first attempt at this changed 224 renders out of 284 and dropped 41 rules
 *  from a single screen.
 *
 *  So a rule may leave the sheet only once nothing outside the part uses what
 *  it styles. Attribution follows decomposition; it cannot lead it. */
interface ScreenUse {
  screen: ItemName;
  /** Classes its markup puts on elements, after composition. */
  classes: Set<string>;
  /** Parts it composes — the only items whose CSS it will be given. */
  parts: Set<ItemName>;
}

export function screenUse(doc: ProjectDoc): ScreenUse[] {
  const out: ScreenUse[] = [];
  for (const [screen, item] of Object.entries(doc.items)) {
    if (item.tier !== 'screen') continue;

    const expansion = item.html.includes('<x-') ? expand(doc, item.html, item) : undefined;
    const html = expansion?.html ?? item.html;

    const classes = new Set<string>();
    for (const found of html.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
      for (const cls of (found[1] ?? '').trim().split(/\s+/)) if (cls !== '') classes.add(cls);
    }
    out.push({ screen, classes, parts: new Set(expansion?.used ?? []) });
  }
  return out;
}

/** The class prefix a part's rules start with. */
export const prefixOf = (doc: ProjectDoc, name: ItemName): string =>
  doc.items[name]?.cssPrefix ?? name;

/** Which parts a set of classes belongs to. */
function owners(doc: ProjectDoc, classes: Iterable<string>): Set<ItemName> {
  const found = new Set<ItemName>();
  for (const cls of classes) {
    for (const [name, item] of Object.entries(doc.items)) {
      if (item.tier === 'screen') continue;
      if (claims(item.cssPrefix ?? name, cls)) found.add(name);
    }
  }
  return found;
}

/** A rule, ready to be written into an item, wrapped in whatever conditions it
 *  was sitting under. */
export function reWrap(rule: CssRule): string {
  let text = rule.text.trim();
  for (const condition of [...rule.conditions].reverse()) {
    const indented = text
      .split('\n')
      .map((line) => (line.trim() === '' ? line : `  ${line}`))
      .join('\n');
    text = `${condition} {\n${indented}\n}`;
  }
  return text;
}

/** Cut spans out of a string. Back to front, so earlier offsets stay valid. */
function cut(text: string, spans: readonly { start: number; end: number }[]): string {
  let out = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + out.slice(span.end);
  }
  return out;
}

/** A conditional at-rule with nothing left inside it is not CSS anybody wants
 *  to read. Removed only when EMPTY — a `@media` that still holds a comment is
 *  left alone, because the comment was written by somebody. */
export function dropEmptyBlocks(css: string): string {
  let out = css;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(/@(media|supports|container|layer|scope)[^{}]*\{\s*\}/g, '');
    if (next === out) break;
    out = next;
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

/** What moving one part's CSS out of the sheets would take.
 *
 *  Pure: it reads the document and returns commands. Nothing is applied here,
 *  so the same call answers "what would happen" and "do it". */
export function attributeCss(doc: ProjectDoc, name: ItemName): Attribution {
  const item = doc.items[name];
  const result: Attribution = { commands: [], moved: [], left: [] };
  if (!item || item.tier === 'screen') return result;

  const prefix = item.cssPrefix ?? name;
  // Only the sheets this item says it needs. A rule for `.tag` sitting in a
  // sheet the tag never links is not this item's to take.
  const sheets = item.sheets ?? [];

  const taken: string[] = [];
  const rewritten: Record<string, string> = {};
  const screens = screenUse(doc);

  /** Screens that write one of these classes by hand instead of composing this
   *  part. They would lose the rule outright. */
  const orphaned = (classes: Set<string>): string[] =>
    screens
      .filter((s) => !s.parts.has(name) && [...classes].some((cls) => s.classes.has(cls)))
      .map((s) => s.screen);

  for (const sheetName of sheets) {
    const css = doc.kit.sheets[sheetName];
    if (css === undefined) continue;

    const spans: CssRule[] = [];
    for (const rule of splitRules(css)) {
      if (rule.selector.startsWith('@')) continue; // keyframes, font-face

      const subjects = subjectClasses(rule.selector);
      const mine = [...subjects].some((cls) => claims(prefix, cls));
      if (!mine) continue;

      const all = owners(doc, subjects);
      if (all.size > 1) {
        result.left.push({ sheet: sheetName, selector: rule.selector, why: 'several owners' });
        continue;
      }

      /* The rule has to keep reaching everything it reaches now. A screen that
       * still writes `.dot` in its own markup gets this rule from the sheet
       * and would get nothing from an item it does not compose. */
      const loose = orphaned(subjects);
      if (loose.length > 0) {
        result.left.push({
          sheet: sheetName,
          selector: rule.selector,
          why: 'screens still use the class',
          screens: loose,
        });
        continue;
      }
      spans.push(rule);
      taken.push(reWrap(rule));
      result.moved.push({
        sheet: sheetName,
        selector: rule.selector,
        conditions: rule.conditions,
        bytes: rule.text.length,
      });
    }

    if (spans.length > 0) rewritten[sheetName] = dropEmptyBlocks(cut(css, spans)).trim();
  }

  if (taken.length === 0) return result;

  for (const [sheetName, css] of Object.entries(rewritten)) {
    result.commands.push({ t: 'sheet.set', name: sheetName, css });
  }
  result.commands.push({
    t: 'item.setCss',
    name,
    css: [item.css?.trim(), ...taken].filter((s) => s && s !== '').join('\n\n'),
    ...(item.cssPrefix !== undefined ? { cssPrefix: item.cssPrefix } : {}),
  });

  return result;
}
