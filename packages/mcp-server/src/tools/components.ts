/* Turning markup into a component, and proving it changed nothing.
 *
 * Extraction is the step where a design system stops being a description and
 * starts being enforced: the header exists once, and the fifty-nine screens
 * that show it cannot drift apart because there is nothing left to drift.
 *
 * It is also the step people are most afraid of, and rightly — moving markup
 * out of a screen can change the render in ways nobody notices until a
 * stakeholder does. So this tool does not ask to be trusted. Composition is
 * byte-exact, so it can compose every screen it touched BEFORE and AFTER and
 * compare the markup character for character. If a single byte moved, nothing
 * is written and the tool says where.
 *
 * That is what makes it safe to do sixty times.
 */

import type { Command, ItemName, Tier } from '@flowkit/core';
import {
  addClass,
  expand,
  matchShape,
  type ProjectDoc,
  parseShape,
  type Shape,
  TIER_RANK,
  unbalanced,
  type Variant,
  withoutClass,
} from '@flowkit/core';
import type { Workspace } from '@flowkit/host';
import { z } from 'zod';
import { failure, fromResult, type ToolReply, text } from '../reply';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

export function registerComponentTools(server: Registrar, ws: Workspace): void {
  register(server, ws, tools());
}

const TIERS = ['element', 'component', 'container'] as const;

/** The reference a call site gets when nothing varies. */
const reference = (args: { name: string; variant?: string }): string =>
  args.variant === undefined ? `<x-${args.name}/>` : `<x-${args.name} variant="${args.variant}"/>`;

/** The reference a call site gets when something does.
 *
 *  One unnamed slot needs no ceremony: the content goes straight inside, which
 *  is how a screen reads best. Named slots are written out, because then there
 *  is more than one hole and which is which has to be said. */
function call(
  args: { name: string; variant?: string },
  slots: readonly string[],
  fills: readonly string[],
): string {
  const open =
    args.variant === undefined ? `<x-${args.name}>` : `<x-${args.name} variant="${args.variant}">`;

  if (slots.length === 1 && slots[0] === '') return `${open}${fills[0] ?? ''}</x-${args.name}>`;

  const inner = slots
    .map((slot, i) => `<x-fill slot="${slot}">${fills[i] ?? ''}</x-fill>`)
    .join('');
  return `${open}${inner}</x-${args.name}>`;
}

/** The template with its holes closed up, for the well-formedness check: a
 *  shape is a complete element or it is not one, and `<x-slot/>` says nothing
 *  either way. */
const withoutSlots = (template: string): string =>
  template.replace(/<x-slot\b[^>]*?(?:\/>|>[\s\S]*?<\/x-slot>)/g, '');

/** The first open tag of some markup, root and all its attributes — what
 *  decides whether two spellings share an element or are different ones. */
const openTagOf = (html: string): string => /<[a-zA-Z][^>]*>/.exec(html)?.[0] ?? '';

/** What the caller says distinguishes this spelling, or what the markup says.
 *
 *  Stated wins: only the caller knows that `is-on` is the variant and `spec-tab`
 *  is the component. With a base to compare against it can be read off instead,
 *  which is what makes the second and third variant of a family one argument
 *  shorter. */
function modifier(args: { html: string; class?: string }, base?: string): string {
  if (args.class !== undefined) return args.class.trim();
  if (base === undefined) return '';

  const classesOf = (html: string): string[] => {
    const open = /<[a-zA-Z][^>]*>/.exec(html);
    const found = open ? /\bclass\s*=\s*"([^"]*)"/.exec(open[0]) : null;
    return (found?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
  };

  const had = new Set(classesOf(base));
  return classesOf(args.html)
    .filter((c) => !had.has(c))
    .join(' ');
}

function tools(): ToolSpec[] {
  return [
    {
      name: 'extract_component',
      config: {
        title: 'Lift markup into a reusable component',
        description:
          'Takes an exact piece of markup out of a screen, makes it a registry item, and ' +
          'replaces every identical occurrence with a reference to it. Pass the markup ' +
          'verbatim as it appears in get_item — whitespace and all. ' +
          'By default it replaces that markup in EVERY item that contains it, which is the ' +
          'point: one header instead of fifty-nine. ' +
          'It composes every screen it touched before and after and refuses the whole ' +
          'extraction if a single byte of rendered markup would change, so this is safe to ' +
          'run repeatedly. One undo step. ' +
          'Name a `variant` to fold a sibling into a component instead of making a new one, and ' +
          'the occurrences become <x-name variant="..."/>. Two kinds: a variant that differs ' +
          'by a class ON THE ROOT (`dot dot-blue`) — pass that `class`; or one where the ' +
          'difference is INSIDE and the root is identical (a nav with the active item on a ' +
          'different button, a tab bar, a step list) — pass just the markup and the whole ' +
          'occurrence is stored as that variant. The inside kind folds into an EXISTING ' +
          'component, so extract the base first, then fold each state. The first call may name ' +
          'a class variant too — the class is lifted off to leave the base. Without this, the ' +
          'other spellings of a family stay raw markup and drift away from the registry. ' +
          'Pass `template` instead of `html` for the parts whose CONTENT varies — a chat ' +
          'message, a field row, a card. Write the component as it should be stored, with ' +
          '<x-slot/> where the content differs, and every occurrence of that shape becomes ' +
          '<x-name>…the content…</x-name>. Everything outside a slot still has to match ' +
          'exactly; put the hole at an element boundary and no attribute has to be guessed at.',
        inputSchema: {
          name: z.string(),
          from: z.string(),
          html: z.string().optional(),
          template: z.string().optional(),
          tier: z.enum(TIERS).optional(),
          description: z.string().optional(),
          everywhere: z.boolean().optional(),
          variant: z.string().optional(),
          class: z.string().optional(),
        },
      },
      writes: true,
      run: async (
        args: {
          name: string;
          from: string;
          html?: string;
          template?: string;
          tier?: Tier;
          description?: string;
          everywhere?: boolean;
          variant?: string;
          class?: string;
        },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const existing = doc.items[args.name];

        if (existing && args.variant === undefined) {
          return failure(
            `"${args.name}" already exists. Pick another name, delete it first, or name a ` +
              'variant to fold this spelling into it.',
          );
        }
        if (existing && existing.tier === 'screen') {
          return failure(`"${args.name}" is a screen, not a component.`);
        }
        const source = doc.items[args.from];
        if (!source) {
          return failure(
            `No item "${args.from}". Available: ${Object.keys(doc.items).slice(0, 12).join(', ')}.`,
          );
        }
        if ((args.html ?? '').trim() === '' && (args.template ?? '').trim() === '') {
          return failure('Nothing to extract: pass `html`, or a `template` with <x-slot/> in it.');
        }
        if (args.html !== undefined && args.template !== undefined) {
          return failure('Pass `html` or `template`, not both — a template already IS the markup.');
        }

        /* Two ways of saying what to lift, and one of everything after.
         *
         * `html` is the exact markup: found by byte equality, replaced by a
         * bare reference. `template` is the same thing with holes: found by
         * matching the literals around them, replaced by a reference carrying
         * what stood in each hole. */
        let shape: Shape | undefined;
        if (args.template !== undefined) {
          const read = parseShape(args.template);
          if ('problem' in read) {
            return failure(`That template cannot be matched: ${read.problem}.`);
          }
          shape = read;
        }

        // Composition alone cannot catch this. Replacing half an open tag with
        // a reference and putting the same half back composes to exactly the
        // original bytes — the check passes and the registry gains a component
        // that is not an element.
        const stored = args.template ?? args.html ?? '';
        const malformed = notWellFormed(shape ? withoutSlots(stored) : stored);
        if (malformed) return failure(`That is not a complete element: ${malformed}`);

        /** The item's markup with every occurrence lifted out, or the markup
         *  unchanged when it holds none. */
        const rewrite = (html: string): string | { problem: string } => {
          if (!shape) return html.replaceAll(stored, reference(args));

          const found = matchShape(html, shape);
          if (found.length === 0) return html;

          let out = '';
          let at = 0;
          for (const match of found) {
            for (const [i, fill] of match.fills.entries()) {
              const wrong = unbalanced(fill);
              if (wrong) {
                const slot = shape.slots[i] === '' ? 'the slot' : `slot "${shape.slots[i]}"`;
                return { problem: `what fell into ${slot} is not whole markup — ${wrong}` };
              }
            }
            out += html.slice(at, match.start) + call(args, shape.slots, match.fills);
            at = match.end;
          }
          return out + html.slice(at);
        };

        const inSource = rewrite(source.html);
        if (typeof inSource === 'object') return failure(`Refused: ${inSource.problem}.`);
        if (inSource === source.html) {
          return failure(
            `That ${args.template ? 'shape' : 'markup'} is not in "${args.from}" — everything ` +
              'outside a slot has to match exactly, whitespace included. Copy it from get_item ' +
              'rather than retyping it.',
          );
        }

        /* The base markup, and what the variant adds to it.
         *
         * A family is written in the screens as siblings — `dot dot-blue`,
         * `dot dot-green` — and the component underneath them is neither: it
         * is `dot`, with the modifier named as a variant. So the first
         * extraction lifts the class off to leave the base, and every later
         * one puts it back to check it is the same component.
         *
         * Nothing here is taken on trust. Whatever this computes is composed
         * and compared byte for byte below, so a markup this cannot reproduce
         * is refused rather than written. */
        const spelling = {
          html: stored,
          ...(args.class !== undefined ? { class: args.class } : {}),
        };
        const base =
          existing?.html ?? (args.variant ? withoutClass(stored, modifier(spelling)) : stored);
        const extra = args.variant ? modifier(spelling, base) : '';

        /* Two shapes a variant can take, and the second is what was missing.
         *
         * A CLASS variant differs from the base by a modifier on the ROOT —
         * `dot dot-blue`. A whole FAMILY does not: a nav, a tab bar, a step
         * list all share an identical root and differ INSIDE — `is-active` on
         * a different child. The registry could already hold those (set_variant
         * takes html), but the extractor refused them, so seven screens got
         * rewritten by hand. Now, when no root class distinguishes it, the
         * whole occurrence is stored as the variant's own markup.
         *
         * The full-markup form folds into an EXISTING component only: the first
         * extraction is what defines the base, and a variant equal to the base
         * would be nothing. Everything below is composed and compared byte for
         * byte regardless, so neither form is taken on trust. */
        const asClass =
          args.variant !== undefined && extra !== '' && addClass(base, extra) === stored;
        // A full-markup variant is allowed ONLY when the ROOT is identical to
        // the base — the difference is genuinely inside (nav active state, a
        // tab, a step). A different root means a different element, not a
        // variant, and is refused as before.
        const sameRoot = openTagOf(stored) === openTagOf(base);
        const asHtml = args.variant !== undefined && !asClass && sameRoot;

        if (args.variant !== undefined && !asClass && !asHtml) {
          return failure(
            `That ${args.template ? 'shape' : 'markup'} is not "${args.name}" plus a class, and ` +
              'its root is not identical either — it differs by more than a class. Extract it as ' +
              'its own component, or match the roots to fold it as a variant.',
          );
        }
        if (asHtml && !existing) {
          return failure(
            `This would fold into "${args.name}" as a whole-markup variant, but there is no ` +
              'component yet to fold into. Extract the base first (no variant), then fold each ' +
              'state as a variant — when the difference is inside, the whole markup is stored.',
          );
        }

        const tier = args.tier ?? existing?.tier ?? 'component';

        const rewritten = new Map<string, string>();
        const candidates =
          (args.everywhere ?? true) ? Object.entries(doc.items) : [[args.from, source] as const];
        for (const [name, item] of candidates) {
          if (name === args.name) continue; // never rewrite the component into itself
          const out = rewrite(item.html);
          if (typeof out === 'object') return failure(`Refused in "${name}": ${out.problem}.`);
          if (out !== item.html) rewritten.set(name, out);
        }
        const targets = candidates.filter(([name]) => rewritten.has(name));

        // A reference cannot go inside something simpler than itself.
        const wrong = targets.filter(([, item]) => RANK[item.tier] <= RANK[tier]);
        if (wrong.length > 0) {
          return failure(
            `A ${tier} cannot go inside ${wrong.map(([n]) => `"${n}"`).join(', ')} ` +
              `(${wrong[0]?.[1].tier}). Extract it at a simpler tier, or name fewer items.`,
          );
        }

        const commands: Command[] = [
          ...(existing
            ? []
            : [
                {
                  t: 'item.create' as const,
                  name: args.name,
                  tier,
                  html: base,
                  ...(args.description !== undefined ? { description: args.description } : {}),
                },
              ]),
          ...(args.variant !== undefined
            ? [
                {
                  t: 'item.setVariant' as const,
                  name: args.name,
                  variant: args.variant,
                  // A class modifier where one distinguishes it; otherwise the
                  // whole markup, for a family that varies inside.
                  value: asHtml ? { html: stored } : { class: extra },
                },
              ]
            : []),
          ...targets.map(
            ([name]): Command => ({
              t: 'item.setHtml',
              name,
              html: rewritten.get(name) ?? '',
            }),
          ),
        ];

        // Prove it before writing it. The component inherits the source's
        // stylesheets, or its rules would be missing wherever it is used.
        const after = preview(doc, commands, args.name, source.sheets ?? []);
        const moved = targets
          .map(([name]) => name)
          .filter((name) => composed(doc, name) !== composed(after, name));

        if (moved.length > 0) {
          return failure(
            `Refused: extracting this would change what ${moved.length} screen(s) render — ` +
              `${moved.slice(0, 5).join(', ')}. Nothing was written. ` +
              'The markup is probably not a whole element, or it spans a boundary.',
          );
        }

        const withSheets: Command[] = [
          ...commands,
          ...(source.sheets && source.sheets.length > 0
            ? [
                {
                  t: 'item.replace' as const,
                  name: args.name,
                  item: { ...after.items[args.name]!, sheets: source.sheets },
                },
              ]
            : []),
        ];

        return ctx.store.runAll(withSheets).then((r) =>
          fromResult(
            r,
            [
              args.variant === undefined
                ? `"${args.name}" is now a ${tier}, used by ${targets.length} item(s)` +
                  `${shape ? ` — ${shape.slots.length} slot(s): ${shape.slots.map((n) => n || 'default').join(', ')}` : ''}.`
                : `"${args.name}:${args.variant}" (${asHtml ? 'own markup' : `class "${extra}"`}) ` +
                  `now stands for ${targets.length} item(s)' worth of that spelling.`,
              targets.length > 1
                ? `Replaced in: ${targets
                    .map(([n]) => n)
                    .slice(0, 8)
                    .join(', ')}` +
                  `${targets.length > 8 ? ` and ${targets.length - 8} more` : ''}.`
                : '',
              'Verified: every screen it touched composes to exactly the markup it had before.',
              'set_variant adds a named alternative.',
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        );
      },
    },

    {
      name: 'list_components',
      config: {
        title: 'The registry',
        description:
          'Every item that is not a screen, with its variants and what uses it. This is what ' +
          'the kit page is built from, and what a screen may reference.',
        inputSchema: {},
      },
      run: (_args: never, ctx: ToolContext): ToolReply => {
        const doc = ctx.store.get();
        const parts = Object.entries(doc.items).filter(([, i]) => i.tier !== 'screen');
        if (parts.length === 0) {
          return text(
            'The registry is empty — every item is still a whole screen. ' +
              'extract_component lifts markup out of one.',
          );
        }

        return text(
          parts
            .map(([name, item]) => {
              const used = Object.entries(doc.items)
                .filter(([, other]) => other.html.includes(`<x-${name}`))
                .map(([n]) => n);
              const variants = Object.keys(item.variants ?? {}).map((v) =>
                v === item.defaultVariant ? `${v} (default)` : v,
              );
              return (
                `${name}  [${item.tier}]  used by ${used.length}` +
                `${variants.length > 0 ? `  variants: ${variants.join(', ')}` : ''}` +
                `${item.description ? `\n    ${item.description}` : ''}`
              );
            })
            .join('\n'),
        );
      },
    },

    {
      name: 'set_variant',
      config: {
        title: 'Name an alternative of a component',
        description:
          'A variant is chosen at a call site by name — <x-field variant="confirmed"/> — and ' +
          'the registry owns what it means. Keep the name about intent ("confirmed") rather ' +
          'than about the mechanism: a screen naming a class can misspell one into existence, ' +
          'and then nothing can enumerate what states a component has. ' +
          'Three mechanisms, smallest first, and most states need only the first. ' +
          '`class` adds classes to the root — "is-confirmed", where the design already styles ' +
          'the modifier. `attrs` sets attributes on the root — aria-pressed="true", ' +
          'disabled="" — for the states a class alone cannot say. `html` replaces the markup ' +
          'outright, for a state that really is different ELEMENTS: a panel with a scrim ' +
          'behind it, a row that grows a second line. An override still takes class and attrs ' +
          'on top, and give it the same slots as the base unless you mean otherwise — a fill ' +
          'for a slot the rendering markup lacks is dropped without a word. ' +
          'Reach for `html` when splitting into two items would be a lie about the design: ' +
          'one component with its states is what a person, and later a code generator, has to ' +
          'see. ' +
          'Fields merge, so a second call can add `attrs` without repeating `class`; pass an ' +
          'empty string (or {}) to clear one. ' +
          'Pass `default` to make this the variant a bare <x-name/> means — for a family with ' +
          'no neutral member, where the base markup alone is not something anyone writes.',
        inputSchema: {
          name: z.string(),
          variant: z.string(),
          class: z.string().optional(),
          attrs: z.record(z.string(), z.string()).optional(),
          html: z.string().optional(),
          label: z.string().optional(),
          note: z.string().optional(),
          default: z.boolean().optional(),
        },
      },
      writes: true,
      run: (
        args: {
          name: string;
          variant: string;
          class?: string;
          attrs?: Record<string, string>;
          html?: string;
          label?: string;
          note?: string;
          default?: boolean;
        },
        ctx: ToolContext,
      ) => {
        /* Merged onto what is already there, and an empty value clears.
         *
         * Replacing wholesale was fine while a variant was one field; with
         * three ways to express a state it means every call has to repeat the
         * others or silently drop them — and dropping `class` from a variant
         * is invisible until somebody looks at the screen. */
        const value: Variant = { ...ctx.store.get().items[args.name]?.variants?.[args.variant] };
        const set = <K extends keyof Variant>(key: K, given: Variant[K], empty: boolean): void => {
          if (given === undefined) return;
          if (empty) delete value[key];
          else value[key] = given;
        };
        set('class', args.class, args.class === '');
        set('attrs', args.attrs, args.attrs !== undefined && Object.keys(args.attrs).length === 0);
        set('html', args.html, args.html === '');
        set('label', args.label, args.label === '');
        set('note', args.note, args.note === '');

        const commands: Command[] = [
          { t: 'item.setVariant', name: args.name, variant: args.variant, value },
          ...(args.default
            ? [
                {
                  t: 'item.setDefaultVariant' as const,
                  name: args.name,
                  variant: args.variant,
                },
              ]
            : []),
        ];

        const attrNames = Object.keys(value.attrs ?? {});
        const by = [
          value.class ? `class "${value.class}"` : '',
          attrNames.length > 0
            ? `attribute${attrNames.length === 1 ? '' : 's'} ${attrNames.join(', ')}`
            : '',
          value.html ? 'markup of its own' : '',
        ].filter((part) => part !== '');

        const how =
          by.length > 0
            ? `, by ${by.join(' + ')}`
            : ' — but nothing to tell it apart yet: give it a class, attrs or html';

        return ctx.store
          .runAll(commands)
          .then((r) =>
            fromResult(
              r,
              `"${args.name}" now has a "${args.variant}" variant${how}` +
                `${args.default ? `, and a bare <x-${args.name}/> means it` : ''}.`,
            ),
          );
      },
    },

    {
      name: 'delete_variant',
      config: {
        title: 'Remove a variant',
        description: 'Screens still asking for it will render the component unmodified.',
        inputSchema: { name: z.string(), variant: z.string() },
      },
      writes: true,
      run: (args: { name: string; variant: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'item.deleteVariant', name: args.name, variant: args.variant })
          .then((r) => fromResult(r, `Removed "${args.variant}" from "${args.name}".`)),
    },
  ];
}

/** Elements that never close. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Why this markup is not a complete element, or nothing when it is.
 *
 *  A component is a thing, not a range of characters that happens to appear in
 *  a file. Without this, "extract from here to there" quietly accepts a
 *  fragment that starts inside one tag and ends inside another. */
function notWellFormed(html: string): string | undefined {
  const text = html.trim();
  if (!text.startsWith('<')) return 'it does not start with a tag.';
  if (!text.endsWith('>')) return 'it does not end with a tag.';

  const stack: string[] = [];
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let seen = 0;

  for (const tag of text.matchAll(pattern)) {
    seen += tag[0].length;
    const closing = tag[1] === '/';
    const name = (tag[2] ?? '').toLowerCase();
    const attrs = tag[3] ?? '';

    if (closing) {
      const open = stack.pop();
      if (open === undefined) return `it closes </${name}> that it never opened.`;
      if (open !== name) return `it closes </${name}> where <${open}> is still open.`;
      continue;
    }
    if (VOID.has(name) || /\/\s*$/.test(attrs)) continue;
    stack.push(name);
  }

  if (stack.length > 0) return `<${stack[stack.length - 1]}> is never closed.`;
  // Angle brackets that no tag accounted for mean a split tag somewhere.
  const brackets = (text.match(/</g) ?? []).length;
  const tags = [...text.matchAll(pattern)].length;
  if (brackets !== tags) return 'part of a tag is missing.';
  void seen;
  return undefined;
}

const RANK: Record<Tier, number> = TIER_RANK;

/** The document these commands would produce, without writing anything.
 *
 *  Applied by hand rather than through the command layer: this is a
 *  hypothetical used to check a decision, and it must not touch the store, the
 *  op-log or the file. */
function preview(
  doc: ProjectDoc,
  commands: readonly Command[],
  name: ItemName,
  sheets: readonly string[],
): ProjectDoc {
  const items = { ...doc.items };

  for (const cmd of commands) {
    if (cmd.t === 'item.create') {
      items[cmd.name] = {
        tier: cmd.tier,
        html: cmd.html ?? '',
        props: {},
        fixtures: { default: { values: {} } },
        ...(sheets.length > 0 ? { sheets: [...sheets] } : {}),
      };
    } else if (cmd.t === 'item.setHtml') {
      const before = items[cmd.name];
      if (before) items[cmd.name] = { ...before, html: cmd.html };
    } else if (cmd.t === 'item.setVariant') {
      // Without this the preview expands `<x-dot variant="blue"/>` against a
      // component that has no such variant, every screen "changes", and a
      // correct extraction is refused with a message about boundaries.
      const before = items[cmd.name];
      if (before) {
        items[cmd.name] = {
          ...before,
          variants: { ...(before.variants ?? {}), [cmd.variant]: cmd.value },
        };
      }
    }
  }
  void name;
  return { ...doc, items };
}

/** What an item's markup expands to. The comparison that makes extraction
 *  provable rather than hopeful. */
function composed(doc: ProjectDoc, name: ItemName): string {
  const item = doc.items[name];
  if (!item) return '';
  return expand(doc, item.html, item).html;
}
