/* The styling substrate: shared stylesheets, the base, and webfonts.
 *
 * These were the hole. Tokens had a tool and nothing else did — so the house
 * style a project is actually built from (`.button`, `.card`, `.field`) could
 * be neither read nor written by an agent. It could see the class names in a
 * screen and had no way to learn what they meant, and no way to change them.
 * The only route left was to copy rules into each screen's own CSS, which is
 * exactly the duplication a shared sheet exists to prevent.
 *
 * A sheet is not an item's CSS. Rules that belong to a component nobody has
 * extracted yet have no item to live on; the sheet is where they wait, and
 * `Item.sheets` is how a screen says it needs one.
 */

import type { Asset, Command, FontFace } from '@flowkit/core';
import {
  attributeCss,
  TAILWIND_SHEET,
  tailwindBuild,
  tailwindHeader,
  tailwindItems,
} from '@flowkit/core';
import {
  compileTailwind,
  fetchGoogleFonts,
  fetchStylesheet,
  provenance,
  tailwindVersion,
  type Workspace,
} from '@flowkit/host';
import { z } from 'zod';
import { failure, fromResult, type ToolReply, text } from '../reply';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

export function registerStyleTools(server: Registrar, ws: Workspace): void {
  register(server, ws, tools());
}

/** A sheet name from where it came: the file, without its extension or its
 *  minified/versioned trimmings. */
function nameOf(source: string): string {
  const last = source.split(/[?#]/)[0]?.split(/[/\\]/).pop() ?? '';
  return last
    .replace(/\.css$/i, '')
    .replace(/\.min$/i, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function tools(): ToolSpec[] {
  return [
    {
      name: 'attribute_css',
      config: {
        title: 'Give a part the CSS that draws it',
        description:
          'A sheet is where rules wait for a component to exist. Once one does, its rules ' +
          'belong on it: that is what makes the design system portable — a part carries the ' +
          'markup AND the CSS that draws it, and can be copied into another project. ' +
          'Only rules this part unambiguously owns are moved: the SUBJECT of the selector ' +
          'has to be one of its classes, in a sheet it actually names. A rule naming two ' +
          'parts, or naming this one only as an ancestor, is reported and left alone. ' +
          'Shows what it would do unless apply=true. Run it after extracting a part, and ' +
          'check a screenshot afterwards — the rules land later in the cascade than they sat.',
        inputSchema: {
          name: z.string().optional().describe('The part. Omit to survey every part at once.'),
          apply: z.boolean().optional().describe('Do it. Without this, only reports.'),
        },
      },
      writes: true,
      run: async (args: { name?: string; apply?: boolean }, ctx: ToolContext) => {
        const doc = ctx.store.get();

        if (args.name === undefined) {
          const rows: string[] = [];
          for (const [name, item] of Object.entries(doc.items)) {
            if (item.tier === 'screen') continue;
            const plan = attributeCss(doc, name);
            if (plan.moved.length === 0 && plan.left.length === 0) continue;
            const bytes = plan.moved.reduce((n, m) => n + m.bytes, 0);
            rows.push(
              `${name.padEnd(14)} ${String(plan.moved.length).padStart(3)} rule(s), ` +
                `${(bytes / 1024).toFixed(1)} KB` +
                (plan.left.length > 0 ? `  (${plan.left.length} left to a person)` : ''),
            );
          }
          return text(
            rows.length === 0
              ? 'Nothing to move: every rule in the sheets belongs to a part that does not exist yet.'
              : [
                  'What each part could take from the shared sheets:',
                  '',
                  ...rows,
                  '',
                  'attribute_css with a name to see the rules, and apply=true to move them.',
                ].join('\n'),
          );
        }

        const item = doc.items[args.name];
        if (!item) return failure(`No item "${args.name}".`);
        if (item.tier === 'screen') {
          return failure(
            `"${args.name}" is a screen. Only a part carries CSS of its own; a screen's ` +
              'styling belongs to the parts it is composed from.',
          );
        }

        const plan = attributeCss(doc, args.name);
        const lines = [
          ...plan.moved.map(
            (m) =>
              `  ${m.selector}${m.conditions.length > 0 ? `  [${m.conditions.join(' ')}]` : ''}` +
              `  — from ${m.sheet}`,
          ),
          ...plan.left.map((l) => `  LEFT  ${l.selector} — ${l.why}, in ${l.sheet}`),
        ];

        if (plan.commands.length === 0) {
          return text(
            [`Nothing to move onto "${args.name}".`, ...lines].join('\n') +
              (plan.left.length > 0
                ? '\n\nThose have to be decided by a person: split the rule, or extract the part ' +
                  'the other half belongs to.'
                : ''),
          );
        }

        if (!args.apply) {
          return text(
            [
              `Would move ${plan.moved.length} rule(s) onto "${args.name}":`,
              ...lines,
              '',
              'Run again with apply=true.',
            ].join('\n'),
          );
        }

        const result = await ctx.store.runAll(plan.commands);
        return fromResult(
          result,
          [`Moved ${plan.moved.length} rule(s) onto "${args.name}".`, ...lines].join('\n'),
        );
      },
    },

    {
      name: 'list_sheets',
      config: {
        title: 'Shared stylesheets',
        description:
          'The named stylesheets in the kit, how big each is, and which items use it. ' +
          'A sheet holds rules shared by several screens — the house style. Read one with ' +
          'get_sheet before writing a screen, so the classes you use are the ones that exist.',
        inputSchema: {},
      },
      run: (_args: never, ctx: ToolContext): ToolReply => {
        const doc = ctx.store.get();
        const names = Object.keys(doc.kit.sheets);
        if (names.length === 0) {
          return text('No shared stylesheets. set_sheet makes one.');
        }

        return text(
          names
            .map((name) => {
              const users = Object.entries(doc.items)
                .filter(([, item]) => (item.sheets ?? []).includes(name))
                .map(([item]) => item);
              return (
                `${name}  ${((doc.kit.sheets[name] ?? '').length / 1024).toFixed(1)} KB  ` +
                `used by ${users.length}${users.length > 0 ? `: ${users.slice(0, 8).join(', ')}` : ''}` +
                `${users.length > 8 ? ` and ${users.length - 8} more` : ''}`
              );
            })
            .join('\n'),
        );
      },
    },

    {
      name: 'get_sheet',
      config: {
        title: 'Read a shared stylesheet',
        description: 'The CSS of one named sheet, verbatim.',
        inputSchema: { name: z.string() },
      },
      run: ({ name }: { name: string }, ctx: ToolContext): ToolReply => {
        const sheets = ctx.store.get().kit.sheets;
        const css = sheets[name];
        if (css === undefined) {
          return failure(
            `No sheet "${name}". Available: ${Object.keys(sheets).join(', ') || 'none'}.`,
          );
        }
        return text(`${name} — ${(css.length / 1024).toFixed(1)} KB\n\n${css}`);
      },
    },

    {
      name: 'set_sheet',
      config: {
        title: 'Write a shared stylesheet',
        description:
          'Replaces a named sheet, or creates it. This is the whole file, not a patch — ' +
          'read it with get_sheet first unless you mean to discard what is there. ' +
          'A screen uses it by naming it in `sheets`; set that with update_item_sheets.',
        inputSchema: { name: z.string(), css: z.string() },
      },
      writes: true,
      run: (args: { name: string; css: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'sheet.set', name: args.name, css: args.css })
          .then((r) => fromResult(r, `Wrote sheet "${args.name}".`)),
    },

    {
      name: 'build_tailwind',
      config: {
        title: 'Compile the Tailwind sheet from the markup',
        description:
          'Reads the class names off the screens that name the "tailwind" sheet — and the ' +
          'parts they are built from — and compiles exactly those utilities into it. Nothing ' +
          'else is in the file: the full framework is 2.9MB and a design uses a fraction of ' +
          'it. ' +
          'The sheet is GENERATED: editing it by hand is pointless because the next markup ' +
          'change rewrites it, and it rebuilds itself after any write that changes a class ' +
          'name. Custom CSS goes in another sheet or in the part itself, which composes last ' +
          'and therefore wins. ' +
          'A project chooses per screen: name the sheet and the screen is on Tailwind, do ' +
          'not and it is not — so a client on Tailwind and an operator side on somebody ' +
          "else's CSS live in one project without meeting. " +
          'Write @theme tokens or plugins into a sheet called "tailwind-input"; it is the ' +
          "compiler's entry, not a stylesheet any screen should name.",
        inputSchema: {},
      },
      writes: true,
      run: async (_args: never, ctx: ToolContext): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const { input, candidates, stamp } = tailwindBuild(doc);
        const items = tailwindItems(doc);

        const started = Date.now();
        const compiled = await compileTailwind(input, candidates).catch((e: Error) => e);
        if (compiled instanceof Error) {
          return failure(`Tailwind refused to build: ${compiled.message}`);
        }

        const css = tailwindHeader(stamp) + compiled;
        const version = await tailwindVersion();
        const written = await ctx.store.run({ t: 'sheet.set', name: TAILWIND_SHEET, css });

        return fromResult(
          written,
          [
            `Built the "${TAILWIND_SHEET}" sheet: ${Math.round(css.length / 1024)}KB from ` +
              `${candidates.length} class name(s) across ${items.length} item(s), in ` +
              `${Date.now() - started}ms.`,
            `Tailwind ${version}.`,
            /* The sheet has to exist before a screen can name it, and it has
             * nothing to compile until one does — so the first build makes an
             * empty one on purpose rather than refusing and leaving no way in. */
            items.length === 0
              ? `Nothing is on Tailwind yet, so this is the groundwork only. ` +
                `update_item_sheets name=<screen> sheets=["${TAILWIND_SHEET}"] puts a screen ` +
                'on it, and the utilities appear by themselves.'
              : 'It rebuilds itself when the markup changes.',
          ].join('\n'),
        );
      },
    },

    {
      name: 'add_stylesheet',
      config: {
        title: 'Bring a stylesheet into the project',
        description:
          'Fetches CSS from a URL or reads it from a local file and stores it IN the project ' +
          "— a framework, a theme, somebody else's file. By value, never as a link: a " +
          'composed screen has no useful base URL, a shared snapshot has to render with ' +
          'nothing behind it, and a link that fails to load leaves a page that still looks ' +
          'plausible and is wrong everywhere. ' +
          'Its `@import`s are followed and the files its `url()`s point at — fonts, images — ' +
          'come in as data URIs; anything left pointing outside is reported rather than ' +
          'passed over in silence. ' +
          'Pin an exact version in the URL: a stylesheet that changes under a design is a ' +
          'design that changed without a commit. ' +
          'Goes in as a named sheet, which screens name in `sheets`; pass base=true only for ' +
          'a reset or a framework everything is built on.',
        inputSchema: {
          source: z.string(),
          name: z.string().optional(),
          base: z.boolean().optional(),
          append: z.boolean().optional(),
        },
      },
      writes: true,
      run: async (
        args: { source: string; name?: string; base?: boolean; append?: boolean },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const name = args.name ?? nameOf(args.source);
        if (!args.base && name === '') {
          return failure('Give the sheet a name — the source does not suggest one.');
        }

        const fetched = await fetchStylesheet(args.source).catch((e: Error) => e);
        if (fetched instanceof Error) {
          return failure(`Could not read ${args.source}: ${fetched.message}`);
        }

        const css = provenance(fetched, new Date()) + fetched.css;
        const doc = ctx.store.get();

        const command: Command = args.base
          ? { t: 'kit.setBase', css: args.append ? `${doc.kit.base}\n\n${css}` : css }
          : {
              t: 'sheet.set',
              name,
              css: args.append && doc.kit.sheets[name] ? `${doc.kit.sheets[name]}\n\n${css}` : css,
            };

        const size = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

        return ctx.store
          .run(command)
          .then((r) =>
            fromResult(
              r,
              [
                args.base
                  ? `Base stylesheet ${args.append ? 'extended with' : 'replaced by'} ${args.source}.`
                  : `Sheet "${name}" ${args.append ? 'extended with' : 'written from'} ${args.source}.`,
                `${size(fetched.bytes.fetched)} fetched, ${size(fetched.bytes.stored)} stored` +
                  `${fetched.inlined > 0 ? `, ${fetched.inlined} file(s) inlined` : ''}` +
                  `${fetched.skipped > 0 ? `, ${fetched.skipped} older font format(s) left as links — a browser only reaches for those when it has nothing better` : ''}.`,
                fetched.left.length > 0
                  ? `Still pointing outside the project — these will not render offline:\n  ${fetched.left
                      .slice(0, 6)
                      .join('\n  ')}`
                  : '',
                args.base
                  ? ''
                  : `Screens use it by naming it: update_item_sheets name=<screen> sheets=["${name}"].`,
              ]
                .filter(Boolean)
                .join('\n'),
            ),
          );
      },
    },

    {
      name: 'delete_sheet',
      config: {
        title: 'Remove a shared stylesheet',
        description:
          'Refused while any item still names it — those screens would lose their styling ' +
          'without anything reporting an error.',
        inputSchema: { name: z.string() },
      },
      writes: true,
      run: (args: { name: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'sheet.delete', name: args.name })
          .then((r) => fromResult(r, `Removed sheet "${args.name}".`)),
    },

    {
      name: 'update_item_sheets',
      config: {
        title: 'Say which stylesheets a screen needs',
        description:
          'Replaces the list of sheets an item pulls in. Composing a screen collects the CSS ' +
          'of the sheets it names, so this is how a screen gets the house style.',
        inputSchema: { name: z.string(), sheets: z.array(z.string()) },
      },
      writes: true,
      run: (args: { name: string; sheets: string[] }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        const item = doc.items[args.name];
        if (!item) {
          return Promise.resolve(
            failure(`No item "${args.name}". Available: ${Object.keys(doc.items).join(', ')}.`),
          );
        }
        const missing = args.sheets.filter((s) => doc.kit.sheets[s] === undefined);
        if (missing.length > 0) {
          return Promise.resolve(
            failure(
              `No sheet named ${missing.join(', ')}. ` +
                `Available: ${Object.keys(doc.kit.sheets).join(', ') || 'none'}.`,
            ),
          );
        }

        return ctx.store
          .run({ t: 'item.replace', name: args.name, item: { ...item, sheets: args.sheets } })
          .then((r) =>
            fromResult(r, `"${args.name}" now uses: ${args.sheets.join(', ') || 'none'}.`),
          );
      },
    },

    {
      name: 'get_base',
      config: {
        title: 'Read the base stylesheet',
        description:
          'The reset and element defaults applied to every screen, before any sheet or item ' +
          'CSS. Where `body`, headings and form controls get their defaults.',
        inputSchema: {},
      },
      run: (_args: never, ctx: ToolContext): ToolReply => {
        const base = ctx.store.get().kit.base;
        return text(base === '' ? 'The base stylesheet is empty.' : base);
      },
    },

    {
      name: 'set_base',
      config: {
        title: 'Write the base stylesheet',
        description:
          'Replaces the reset and element defaults for every screen. The whole file, not a ' +
          'patch. Use tokens rather than literal values, or a theme switch stops working.',
        inputSchema: { css: z.string() },
      },
      writes: true,
      run: (args: { css: string }, ctx: ToolContext) =>
        ctx.store.run({ t: 'kit.setBase', css: args.css }).then((r) => fromResult(r, 'Base set.')),
    },

    {
      name: 'add_font',
      config: {
        title: 'Add a webfont',
        description:
          'Fetches a Google Fonts stylesheet and embeds the faces IN the document as bytes. ' +
          'That is not a preference: a composed screen has no useful base URL, a shared file ' +
          'has to render with no network, and a dropped font link falls back to a system ' +
          'stack silently — every text metric wrong while still looking plausible. ' +
          'Pass the ordinary Google Fonts css2 URL. Then point --font-sans (or whichever ' +
          'token your base uses) at the family with set_token.',
        inputSchema: {
          url: z.string(),
          subsets: z.array(z.string()).optional(),
        },
      },
      writes: true,
      run: async (
        args: { url: string; subsets?: string[] },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        if (!/^https:\/\/fonts\.googleapis\.com\//.test(args.url)) {
          return failure(
            'Only Google Fonts css2 URLs are supported here. ' +
              'For anything else, add the bytes as an asset and use the font commands.',
          );
        }

        let fetched: { fonts: FontFace[]; assets: Record<string, Asset> };
        try {
          fetched = await fetchGoogleFonts(args.url, args.subsets ?? ['latin', 'latin-ext']);
        } catch (e) {
          return failure(
            `Could not fetch that font: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (fetched.fonts.length === 0) {
          return failure('That stylesheet named no faces. Check the URL in a browser.');
        }

        // Assets first, then the faces that point at them — and all of it as
        // one command, so a half-added font is not a state the document can be
        // left in, and one undo takes the whole thing back.
        const commands: Command[] = [
          ...Object.entries(fetched.assets).map(
            ([id, asset]): Command => ({ t: 'asset.add', id, asset }),
          ),
          ...fetched.fonts.map(
            (face): Command => ({
              t: 'font.add',
              asset: face.asset,
              family: face.family,
              weight: face.weight,
              style: face.style,
              ...(face.sourceUrl ? { sourceUrl: face.sourceUrl } : {}),
              // Without the range, the second subset of a weight replaces the
              // first and the accented characters go quietly missing.
              ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
            }),
          ),
        ];

        const bytes = Object.values(fetched.assets).reduce((n, a) => n + a.bytes.length, 0);
        const families = [...new Set(fetched.fonts.map((f) => f.family))];

        return ctx.store
          .runAll(commands)
          .then((r) =>
            fromResult(
              r,
              `Embedded ${fetched.fonts.length} face(s) of ${families.join(', ')} — ` +
                `${(bytes / 1024).toFixed(0)} KB. ` +
                'Point a font token at it with set_token to use it.',
            ),
          );
      },
    },

    {
      name: 'remove_font',
      config: {
        title: 'Remove a webfont',
        description:
          'Drops every face of a family and the bytes behind them. Anything still asking for ' +
          'that family falls back to the next font in its stack.',
        inputSchema: { family: z.string() },
      },
      writes: true,
      run: (args: { family: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        const faces = doc.kit.fonts.filter((f) => f.family === args.family);
        if (faces.length === 0) {
          const families = [...new Set(doc.kit.fonts.map((f) => f.family))];
          return Promise.resolve(
            failure(`No font "${args.family}". Embedded: ${families.join(', ') || 'none'}.`),
          );
        }

        const going = new Set(faces.map((f) => f.asset));
        // Only drop bytes nothing else points at.
        const kept = doc.kit.fonts.filter((f) => f.family !== args.family).map((f) => f.asset);
        for (const asset of kept) going.delete(asset);

        // One delete per weight and style: each takes every subset of that
        // face with it, so listing them individually would repeat work.
        const cuts = [...new Set(faces.map((f) => `${f.weight}|${f.style}`))];
        const commands: Command[] = [
          ...cuts.map((cut): Command => {
            const [weight, style] = cut.split('|');
            return {
              t: 'font.delete',
              family: args.family,
              weight: weight ?? '400',
              style: (style ?? 'normal') as 'normal' | 'italic',
            };
          }),
          ...[...going].map((id): Command => ({ t: 'asset.delete', id })),
        ];

        return ctx.store
          .runAll(commands)
          .then((r) => fromResult(r, `Removed ${faces.length} face(s) of ${args.family}.`));
      },
    },
  ];
}
