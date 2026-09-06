/* Write tools.
 *
 * Every one dispatches a single command. There is no tool that writes the
 * document any other way, and no file path is ever exposed — the contract is
 * enforceable precisely because this is the only door.
 *
 * Each returns the command layer's diagnostics verbatim on rejection, so a
 * refusal names what would have been accepted instead of just saying no.
 */

import type { Cell, Command } from '@flowkit/core';
import { apply, applyAll, NONE, toCell } from '@flowkit/core';
import type { LoadedImage, Workspace } from '@flowkit/host';
import { loadImage } from '@flowkit/host';
import { z } from 'zod';
import { failure, fromResult, type ToolReply, text } from '../reply';
import {
  type Registrar,
  register,
  type ToolContext,
  type ToolSpec,
  writeToolSpecs,
} from './registrar';

const TIERS = ['element', 'component', 'container', 'screen', 'layout'] as const;

export function registerWriteTools(server: Registrar, ws: Workspace): void {
  register(server, ws, tools());
}

function tools(): ToolSpec[] {
  return [
    {
      name: 'create_item',
      config: {
        title: 'Create an item',
        description:
          'Add a screen, layout, container, component or element. Names are unique ACROSS ' +
          'tiers, because a template refers to an item by name alone.',
        inputSchema: {
          name: z.string(),
          tier: z.enum(TIERS),
          html: z.string().optional(),
          description: z.string().optional(),
        },
      },
      writes: true,
      run: (
        args: {
          name: string;
          tier: (typeof TIERS)[number];
          html?: string;
          description?: string;
        },
        ctx: ToolContext,
      ) =>
        ctx.store
          .run({
            t: 'item.create',
            name: args.name,
            tier: args.tier,
            ...(args.html !== undefined ? { html: args.html } : {}),
            ...(args.description !== undefined ? { description: args.description } : {}),
          })
          .then((r) => fromResult(r, `Created ${args.tier} "${args.name}".`)),
    },

    {
      name: 'duplicate_item',
      config: {
        title: 'Copy an item under a new name',
        description:
          'The whole item, not just its markup: stylesheets, the attributes its <body> ' +
          'carries, its variants and its size — a screen copied without those renders as a ' +
          'different screen. Use it to work on something without touching the original: ' +
          'decompose a copy, compare the two, throw the copy away. ' +
          'Name a `group` to put the copy on the canvas beside the rest of that flow.',
        inputSchema: {
          from: z.string(),
          to: z.string(),
          group: z.string().optional(),
          order: z.number().optional(),
          title: z.string().optional(),
        },
      },
      writes: true,
      run: (
        args: { from: string; to: string; group?: string; order?: number; title?: string },
        ctx: ToolContext,
      ) => {
        const doc = ctx.store.get();
        const source = doc.items[args.from];
        if (!source) {
          return Promise.resolve(
            failure(
              `No item "${args.from}". Available: ${Object.keys(doc.items).slice(0, 12).join(', ')}.`,
            ),
          );
        }
        if (doc.items[args.to]) {
          return Promise.resolve(failure(`"${args.to}" already exists. Pick another name.`));
        }

        // A copy is authored, whatever the original was: leaving `generated`
        // on it would make the next build_kit overwrite somebody's work.
        const { generated: _generated, ...rest } = source;

        return ctx.store
          .runAll([
            { t: 'item.replace', name: args.to, item: { ...rest } },
            ...(args.group
              ? [
                  {
                    t: 'node.add' as const,
                    id: args.to,
                    node: {
                      screen: args.to,
                      fixture: 'default',
                      title: args.title ?? args.to,
                      groups: [args.group],
                      ...(args.order !== undefined ? { order: args.order } : {}),
                    },
                  },
                ]
              : []),
          ])
          .then((r) =>
            fromResult(
              r,
              `Copied "${args.from}" to "${args.to}"` +
                `${args.group ? `, on the canvas in "${args.group}"` : ''}.`,
            ),
          );
      },
    },

    {
      name: 'set_item_html',
      config: {
        title: 'Replace an item’s markup',
        description:
          'Every visible string must carry a data-t key, and colours must come from tokens ' +
          'via var(--x) rather than being written literally.',
        inputSchema: { name: z.string(), html: z.string() },
      },
      writes: true,
      run: (args: { name: string; html: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'item.setHtml', name: args.name, html: args.html })
          .then((r) => fromResult(r, `Updated markup of "${args.name}".`)),
    },

    {
      name: 'set_item_meta',
      config: {
        title: 'Describe an item, pin its size, or record anything else about it',
        description:
          'The description is what the kit sheets and list_items show, so it is the one line ' +
          'that says what this part is for. `viewport` names the size a screen or container is ' +
          'designed at, when it is not the toolbar default — the kit draws it at that width. ' +
          '`tier` moves the item between tiers when the choice at extract time turned out ' +
          'wrong (a sidebar taken as a container that should be a component): references are ' +
          'unaffected, and a change that would dangle a node is refused. ' +
          '`meta` is free-form and nothing here reads it: what this part expects to be given, ' +
          'how it behaves at another width, the endpoints a screen reads and writes, a ticket, ' +
          'a rule it has to obey. It is where an observation goes BEFORE there is a field for ' +
          'it, and it is carried into the exported spec as written. Keys merge with what is ' +
          'there; a key set to null is removed.',
        inputSchema: {
          name: z.string(),
          description: z.string().optional(),
          viewport: z.string().optional(),
          tier: z.enum(TIERS).optional(),
          meta: z.record(z.string(), z.unknown()).optional(),
        },
      },
      writes: true,
      run: (
        args: {
          name: string;
          description?: string;
          viewport?: string;
          tier?: (typeof TIERS)[number];
          meta?: Record<string, unknown>;
        },
        ctx: ToolContext,
      ) => {
        // Demoting a screen that nodes point at would leave them dangling —
        // and node validation does not re-run on an item edit, so nothing else
        // would stop it. The reference case a tier change is FOR (a container
        // that should be a component) never involves nodes, so this guards
        // only the one move that breaks the canvas.
        const guard = tierGuard(ctx.store.get(), args.name, args.tier);
        if (guard) return Promise.resolve(guard);

        return ctx.store
          .run({
            t: 'item.setMeta',
            name: args.name,
            ...(args.description !== undefined ? { description: args.description } : {}),
            ...(args.viewport !== undefined ? { viewport: args.viewport } : {}),
            ...(args.tier !== undefined ? { tier: args.tier } : {}),
            ...(args.meta !== undefined
              ? { meta: merged(ctx.store.get().items[args.name]?.meta, args.meta) }
              : {}),
          })
          .then((r) => fromResult(r, `Updated "${args.name}".`));
      },
    },

    {
      name: 'set_screen_image',
      config: {
        title: 'Make a screen a picture, or take the picture away',
        description:
          'A screen can stand in as a MOCKUP before anybody writes markup for it: point this ' +
          'at a PNG and it becomes a screen on the canvas like any other — connectable, ' +
          'annotatable, exportable. That is how a project starts from what a designer already ' +
          'has: twenty pictures become twenty screens, and each is replaced by real markup ' +
          'when its turn comes rather than all at once. ' +
          'The screen is created if it does not exist, so a folder of mockups is one call ' +
          'each; name a `group` to put it on the canvas in that flow. ' +
          'MARKUP WINS as soon as the screen has any — write markup and the picture stops ' +
          'being drawn, so converting is write, render, correct, with the mockup behind you. ' +
          'validate then reminds you the picture is still in the document; omit `source` to ' +
          'clear it. ' +
          'The bytes go IN the document, because a project has to render offline and survive ' +
          'being handed to somebody as one file — so use a picture of the size you would put ' +
          'in a document, not a print master.',
        inputSchema: {
          name: z.string(),
          source: z
            .string()
            .optional()
            .describe('A path or URL to a png, jpg, webp, avif, gif or svg. Omit to clear.'),
          title: z.string().optional(),
          group: z.string().optional(),
          order: z.number().optional(),
        },
      },
      writes: true,
      run: async (
        args: { name: string; source?: string; title?: string; group?: string; order?: number },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const before = doc.items[args.name];

        if (args.source === undefined) {
          if (!before) return failure(`No item "${args.name}".`);
          return ctx.store
            .run({ t: 'item.setImage', name: args.name, asset: null })
            .then((r) => fromResult(r, `"${args.name}" is no longer a mockup.`));
        }

        let image: LoadedImage;
        try {
          image = await loadImage(args.source);
        } catch (e) {
          return failure(e instanceof Error ? e.message : String(e));
        }

        const assetId = `mockup-${args.name}`;
        const commands: Command[] = [
          ...(before
            ? []
            : [{ t: 'item.create' as const, name: args.name, tier: 'screen' as const }]),
          {
            t: 'asset.add' as const,
            id: assetId,
            asset: {
              kind: 'image' as const,
              mime: image.mime,
              bytes: image.bytes,
              label: image.label,
              sourceUrl: args.source,
            },
          },
          { t: 'item.setImage' as const, name: args.name, asset: assetId },
          ...(args.group && !doc.flow.nodes[args.name]
            ? [
                {
                  t: 'node.add' as const,
                  id: args.name,
                  node: {
                    screen: args.name,
                    fixture: 'default',
                    title: args.title ?? args.name,
                    groups: [args.group],
                    ...(args.order !== undefined ? { order: args.order } : {}),
                  },
                },
              ]
            : []),
        ];

        const weight = Math.round(image.size / 1024);
        return ctx.store
          .runAll(commands)
          .then((r) =>
            fromResult(
              r,
              `"${args.name}" is a mockup of ${image.label} (${weight}KB)` +
                `${args.group ? `, on the canvas in "${args.group}"` : ''}.` +
                (weight > 500
                  ? ' That is heavy for a document that travels as one file — consider a smaller picture.'
                  : ''),
            ),
          );
      },
    },

    {
      name: 'delete_asset',
      config: {
        title: 'Remove a picture from the document',
        description:
          'Bytes live IN the document, so a picture nothing draws is weight every export and ' +
          'every share carries. validate names them. Deleting a screen deliberately does NOT ' +
          'take its mockup with it — two screens can share one picture, and a cascade is how ' +
          'somebody loses the other one — so this is the separate, deliberate step.',
        inputSchema: { id: z.string() },
      },
      writes: true,
      run: (args: { id: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        const asset = doc.assets[args.id];
        if (!asset) {
          return Promise.resolve(
            failure(
              `No asset "${args.id}". Available: ${Object.keys(doc.assets).slice(0, 12).join(', ')}.`,
            ),
          );
        }

        const drawnBy = Object.entries(doc.items)
          .filter(([, item]) => item.image === args.id)
          .map(([name]) => name);
        if (drawnBy.length > 0) {
          return Promise.resolve(
            failure(
              `"${args.id}" is still the mockup of ${drawnBy.join(', ')}. Give those screens ` +
                'markup, or clear the picture with set_screen_image, first.',
            ),
          );
        }
        if (doc.kit.fonts.some((f) => f.asset === args.id)) {
          return Promise.resolve(
            failure(`"${args.id}" is a font face in use. Remove it with remove_font instead.`),
          );
        }

        return ctx.store
          .run({ t: 'asset.delete', id: args.id })
          .then((r) =>
            fromResult(
              r,
              `Removed "${args.id}"${asset.label ? ` (${asset.label})` : ''} — ` +
                `${Math.round((asset.bytes.length * 3) / 4 / 1024)}KB lighter.`,
            ),
          );
      },
    },

    {
      name: 'set_item_root',
      config: {
        title: 'Set the attributes a screen’s <body> carries',
        description:
          'A screen is a document, and some of its design lives on the document element: ' +
          'STRAIW writes class="app" for the shell and data-spec="closed" for the state of ' +
          'the panel, and its CSS reads both. Markup alone cannot say this, and a screen ' +
          'rebuilt without it renders as a different screen. Pass every attribute the body ' +
          'should carry; omit `attrs` to clear them.',
        inputSchema: { name: z.string(), attrs: z.record(z.string(), z.string()).optional() },
      },
      writes: true,
      run: (args: { name: string; attrs?: Record<string, string> }, ctx: ToolContext) =>
        ctx.store.run({ t: 'item.setRoot', name: args.name, attrs: args.attrs ?? null }).then((r) =>
          fromResult(
            r,
            args.attrs
              ? `"${args.name}" body: ${Object.entries(args.attrs)
                  .map(([k, v]) => `${k}="${v}"`)
                  .join(' ')}.`
              : `"${args.name}" body carries nothing now.`,
          ),
        ),
    },

    {
      name: 'set_item_css',
      config: {
        title: 'Replace an item’s CSS',
        description:
          'Selectors must start with the item’s own name (.button, .button__label, ' +
          '.button--primary) so styles cannot leak between items. Colours come from tokens.',
        inputSchema: { name: z.string(), css: z.string(), cssPrefix: z.string().optional() },
      },
      writes: true,
      run: (args: { name: string; css: string; cssPrefix?: string }, ctx: ToolContext) =>
        ctx.store
          .run({
            t: 'item.setCss',
            name: args.name,
            css: args.css,
            ...(args.cssPrefix !== undefined ? { cssPrefix: args.cssPrefix } : {}),
          })
          .then((r) => fromResult(r, `Updated CSS of "${args.name}".`)),
    },

    {
      name: 'delete_item',
      config: {
        title: 'Delete an item',
        description: 'Refused while any node still points at it.',
        inputSchema: { name: z.string() },
      },
      writes: true,
      run: (args: { name: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'item.delete', name: args.name })
          .then((r) => fromResult(r, `Deleted "${args.name}".`)),
    },

    {
      name: 'add_node',
      config: {
        title: 'Put a screen on the canvas',
        description:
          'A node shows one screen. Leave col/lane out and the canvas arranges it from the ' +
          'connections — usually the right answer. Give them to place it deliberately: one ' +
          'column is a screen width plus the corridor, one lane a screen height plus its ' +
          'captions, and half-steps are allowed.',
        inputSchema: {
          screen: z.string(),
          id: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          group: z.string().optional(),
          order: z.number().optional(),
          col: z.number().optional(),
          lane: z.number().optional(),
        },
      },
      writes: true,
      run: (
        args: {
          screen: string;
          id?: string;
          title?: string;
          description?: string;
          group?: string;
          order?: number;
          col?: number;
          lane?: number;
        },
        ctx: ToolContext,
      ) =>
        ctx.store
          .run({
            t: 'node.add',
            ...(args.id !== undefined ? { id: args.id } : {}),
            node: {
              screen: args.screen,
              fixture: 'default',
              ...(args.col !== undefined ? { col: args.col } : {}),
              ...(args.lane !== undefined ? { lane: args.lane } : {}),
              ...(args.title !== undefined ? { title: args.title } : {}),
              ...(args.description !== undefined ? { description: args.description } : {}),
              ...(args.group !== undefined ? { groups: [args.group] } : {}),
              ...(args.order !== undefined ? { order: args.order } : {}),
            },
          })
          .then((r) => fromResult(r, `Added a node for "${args.screen}".`)),
    },

    {
      name: 'update_node',
      config: {
        title: 'Change a node',
        description:
          'Title, description, flow, order, placement — or which SCREEN it shows. Omitted ' +
          'fields are left alone. Point it at another screen with `screen` (and `layout` for ' +
          'the layout, `fixture` for the fixture): this is how you repoint a node without ' +
          'losing its place on the canvas, its flow or its connections. ' +
          'Move it with col/lane; x/y are accepted and converted, but pixels only mean ' +
          'something against a viewport, so col/lane is what to place by. ' +
          'Name a `viewport` and the placement is stored FOR that viewport, leaving the ' +
          'others alone — which is what you want, because the grid step is a screen width ' +
          'across and a screen height down, so one arrangement cannot be right at 390 and at ' +
          '1440. Omit it and you set the shared placement every viewport falls back to. ' +
          '`meta` is free-form and nothing here reads it: roles allowed on this screen, the ' +
          'endpoints it reads and writes, a ticket, a rule it has to obey. It is where ' +
          'knowledge lands before there is a field for it, and it is carried into the ' +
          'exported spec as written. Keys merge; a key set to null is removed.',
        inputSchema: {
          id: z.string(),
          screen: z.string().optional(),
          layout: z.string().optional(),
          fixture: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          groups: z.array(z.string()).optional(),
          order: z.number().optional(),
          col: z.number().optional(),
          lane: z.number().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          viewport: z.string().optional(),
          meta: z.record(z.string(), z.unknown()).optional(),
        },
      },
      writes: true,
      run: (
        args: {
          id: string;
          screen?: string;
          layout?: string;
          fixture?: string;
          title?: string;
          description?: string;
          groups?: string[];
          order?: number;
          col?: number;
          lane?: number;
          x?: number;
          y?: number;
          viewport?: string;
          meta?: Record<string, unknown>;
        },
        ctx: ToolContext,
      ) => {
        const place = cellFrom({ ...args, id: args.id }, ctx);
        if ('error' in place) return Promise.resolve(failure(place.error));

        return ctx.store
          .run({
            t: 'node.update',
            id: args.id,
            patch: {
              ...(args.screen !== undefined ? { screen: args.screen } : {}),
              ...(args.layout !== undefined ? { layout: args.layout } : {}),
              ...(args.fixture !== undefined ? { fixture: args.fixture } : {}),
              ...(args.title !== undefined ? { title: args.title } : {}),
              ...(args.description !== undefined ? { description: args.description } : {}),
              ...(args.groups !== undefined ? { groups: args.groups } : {}),
              ...(args.order !== undefined ? { order: args.order } : {}),
              ...(args.meta !== undefined
                ? { meta: merged(ctx.store.get().flow.nodes[args.id]?.meta, args.meta) }
                : {}),
              ...place.patch,
            },
          })
          .then((r) => fromResult(r, `Updated node "${args.id}".${placementNote(args, ctx)}`));
      },
    },

    {
      name: 'clear_placement',
      config: {
        title: 'Drop a per-viewport placement',
        description:
          "Remove a node's own placement for one viewport (or all of them), so it falls back " +
          'to the shared col/lane — or to auto-layout if there is none. Use this when a hand ' +
          'placement on one size is fighting the position you want everywhere. Name a ' +
          'viewport to clear just that one; omit it to clear them all.',
        inputSchema: {
          id: z.string(),
          viewport: z.string().optional().describe('Just this size. Omit to clear every one.'),
        },
      },
      writes: true,
      run: (args: { id: string; viewport?: string }, ctx: ToolContext) => {
        const node = ctx.store.get().flow.nodes[args.id];
        if (!node) return Promise.resolve(failure(`No node "${args.id}".`));

        const cells = node.cells ?? {};
        const had = Object.keys(cells);
        if (had.length === 0) {
          return Promise.resolve(text(`"${args.id}" has no per-viewport placement to clear.`));
        }
        if (args.viewport && !(args.viewport in cells)) {
          return Promise.resolve(
            failure(
              `"${args.id}" has no placement for "${args.viewport}". It has: ${had.join(', ')}.`,
            ),
          );
        }

        const remaining = args.viewport
          ? Object.fromEntries(Object.entries(cells).filter(([v]) => v !== args.viewport))
          : {};
        const cleared = args.viewport ? [args.viewport] : had;

        return ctx.store
          .run({
            t: 'node.update',
            id: args.id,
            // undefined removes the key entirely; an object replaces it whole.
            patch: { cells: Object.keys(remaining).length > 0 ? remaining : undefined },
          })
          .then((r) =>
            fromResult(
              r,
              `Cleared the ${cleared.join(', ')} placement on "${args.id}". ` +
                'It now uses its shared col/lane, or auto-layout if it has none.',
            ),
          );
      },
    },

    {
      name: 'delete_node',
      config: {
        title: 'Remove a node',
        description: 'Its connections go with it, and come back together on undo.',
        inputSchema: { id: z.string() },
      },
      writes: true,
      run: (args: { id: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'node.delete', id: args.id })
          .then((r) => fromResult(r, `Removed "${args.id}".`)),
    },

    {
      name: 'connect',
      config: {
        title: 'Connect two screens',
        description: 'A directed connection between nodes, optionally labelled.',
        inputSchema: {
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
          id: z.string().optional(),
        },
      },
      writes: true,
      run: (args: { from: string; to: string; label?: string; id?: string }, ctx: ToolContext) =>
        ctx.store
          .run({
            t: 'edge.connect',
            from: args.from,
            to: args.to,
            ...(args.label !== undefined ? { label: args.label } : {}),
            ...(args.id !== undefined ? { id: args.id } : {}),
          })
          .then((r) => fromResult(r, `Connected ${args.from} -> ${args.to}.`)),
    },

    {
      name: 'disconnect',
      config: {
        title: 'Remove a connection',
        description: 'By edge id, as reported by list_edges.',
        inputSchema: { id: z.string() },
      },
      writes: true,
      run: (args: { id: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'edge.delete', id: args.id })
          .then((r) => fromResult(r, 'Disconnected.')),
    },

    {
      name: 'set_token',
      config: {
        title: 'Set design tokens',
        description:
          'Change custom properties in one theme. Pass `tokens` to set a whole palette in ' +
          'one call — bringing an existing design system in one token at a time is dozens ' +
          'of round trips, and a half-applied palette between them. ' +
          'Every theme should define the SAME NAMES with different values; the theme that ' +
          'lacks one renders half-styled, and validate reports it as token-not-in-all-themes.',
        inputSchema: {
          theme: z.string(),
          token: z.string().optional().describe('One token. Use `tokens` for several.'),
          value: z.string().optional(),
          tokens: z
            .record(z.string(), z.string())
            .optional()
            .describe('Name to value, e.g. {"--bg": "#08090d", "--text": "#f0f0f5"}.'),
        },
      },
      writes: true,
      run: (
        args: { theme: string; token?: string; value?: string; tokens?: Record<string, string> },
        ctx: ToolContext,
      ) => {
        const pairs: [string, string][] = [
          ...Object.entries(args.tokens ?? {}),
          ...(args.token !== undefined && args.value !== undefined
            ? ([[args.token, args.value]] as [string, string][])
            : []),
        ];
        if (pairs.length === 0) {
          return Promise.resolve(
            failure('Nothing to set. Pass token and value, or tokens={"--name": "value"}.'),
          );
        }

        const doc = ctx.store.get();
        if (!doc.kit.themes[args.theme]) {
          return Promise.resolve(
            failure(
              `No theme "${args.theme}". Available: ${Object.keys(doc.kit.themes).join(', ')}. ` +
                'add_theme makes one.',
            ),
          );
        }

        const named = pairs.filter(([name]) => !name.startsWith('--'));
        if (named.length > 0) {
          return Promise.resolve(
            failure(
              `A token name includes its leading dashes: ${named.map(([n]) => `"${n}"`).join(', ')}` +
                ` should be ${named.map(([n]) => `"--${n}"`).join(', ')}.`,
            ),
          );
        }

        // One entry in the log: a palette is one edit, and undoing it should
        // not mean pressing undo forty times.
        return ctx.store
          .runAll(
            pairs.map(([token, value]) => ({
              t: 'theme.setToken' as const,
              theme: args.theme,
              token,
              value,
            })),
          )
          .then((r) =>
            fromResult(
              r,
              pairs.length === 1
                ? `${args.theme}: ${pairs[0]?.[0]} = ${pairs[0]?.[1]}`
                : `Set ${pairs.length} tokens in "${args.theme}".`,
            ),
          );
      },
    },

    {
      name: 'remove_token',
      config: {
        title: 'Remove a design token',
        description:
          'Takes the name out. Setting it to an empty string does not: that leaves the name ' +
          'defined as nothing, which every other theme then has to carry too. ' +
          'Removed from EVERY theme unless one is named, because a token in one theme and ' +
          'not another is the thing validate complains about.',
        inputSchema: {
          token: z.string(),
          theme: z.string().optional().describe('Just this theme. Defaults to all of them.'),
        },
      },
      writes: true,
      run: (args: { token: string; theme?: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        const themes = args.theme ? [args.theme] : Object.keys(doc.kit.themes);

        if (args.theme && !doc.kit.themes[args.theme]) {
          return Promise.resolve(
            failure(
              `No theme "${args.theme}". Available: ${Object.keys(doc.kit.themes).join(', ')}.`,
            ),
          );
        }

        const holding = themes.filter((id) => doc.kit.themes[id]?.tokens[args.token] !== undefined);
        if (holding.length === 0) {
          return Promise.resolve(
            failure(
              `No theme defines "${args.token}"${args.theme ? ` in "${args.theme}"` : ''}. ` +
                'get_tokens lists what there is.',
            ),
          );
        }

        return ctx.store
          .runAll(
            holding.map((theme) => ({ t: 'theme.removeToken' as const, theme, token: args.token })),
          )
          .then((r) => fromResult(r, `Removed ${args.token} from ${holding.join(', ')}.`));
      },
    },

    {
      name: 'add_theme',
      config: {
        title: 'Add a theme',
        description:
          'A new theme starts as a COPY of an existing one, because a theme with no tokens ' +
          'renders nothing and the names have to match anyway. Change what differs with ' +
          'set_token afterwards.',
        inputSchema: {
          id: z.string(),
          label: z.string(),
          from: z.string().optional().describe('Theme to copy. Defaults to the current default.'),
        },
      },
      writes: true,
      run: (args: { id: string; label: string; from?: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        if (doc.kit.themes[args.id]) {
          return Promise.resolve(
            failure(`A theme "${args.id}" already exists. set_token changes what is in it.`),
          );
        }
        const source = args.from ?? doc.kit.defaultTheme;
        const from = doc.kit.themes[source];
        if (!from) {
          return Promise.resolve(
            failure(`No theme "${source}". Available: ${Object.keys(doc.kit.themes).join(', ')}.`),
          );
        }

        return ctx.store
          .run({
            t: 'theme.set',
            id: args.id,
            theme: { label: args.label, tokens: { ...from.tokens } },
          })
          .then((r) =>
            fromResult(
              r,
              `Added "${args.id}" with ${Object.keys(from.tokens).length} tokens copied from ` +
                `"${source}".`,
            ),
          );
      },
    },

    {
      name: 'delete_theme',
      config: {
        title: 'Remove a theme',
        description: 'Refused for the default one — every document renders in something.',
        inputSchema: { id: z.string() },
      },
      writes: true,
      run: (args: { id: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        if (!doc.kit.themes[args.id]) {
          return Promise.resolve(
            failure(`No theme "${args.id}". Available: ${Object.keys(doc.kit.themes).join(', ')}.`),
          );
        }
        if (doc.kit.defaultTheme === args.id) {
          return Promise.resolve(
            failure(
              `"${args.id}" is the default theme. Point the default at another one with ` +
                'set_default_theme first.',
            ),
          );
        }
        return ctx.store
          .run({ t: 'theme.delete', id: args.id })
          .then((r) => fromResult(r, `Removed theme "${args.id}".`));
      },
    },

    {
      name: 'set_default_theme',
      config: {
        title: 'Choose the theme a design renders in',
        description:
          'What every render, export and screenshot uses when nobody says otherwise. A ' +
          'project whose design is light while the default is dark shows the wrong thing ' +
          'everywhere it is looked at.',
        inputSchema: { theme: z.string() },
      },
      writes: true,
      run: (args: { theme: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        if (!doc.kit.themes[args.theme]) {
          return Promise.resolve(
            failure(
              `No theme "${args.theme}". Available: ${Object.keys(doc.kit.themes).join(', ')}.`,
            ),
          );
        }
        return ctx.store
          .run({ t: 'kit.setDefaultTheme', theme: args.theme })
          .then((r) => fromResult(r, `Renders default to "${args.theme}" now.`));
      },
    },

    {
      name: 'set_strings',
      config: {
        title: 'Set translations',
        description:
          'Merges by default, so sending twenty keys does not drop the rest. Keys are the ' +
          'data-t values in the markup.',
        inputSchema: {
          locale: z.string(),
          entries: z.record(z.string(), z.string()),
          replace: z.boolean().optional(),
        },
      },
      writes: true,
      run: (
        args: { locale: string; entries: Record<string, string>; replace?: boolean },
        ctx: ToolContext,
      ) =>
        ctx.store
          .run({
            t: 'strings.set',
            locale: args.locale,
            entries: args.entries,
            ...(args.replace !== undefined ? { replace: args.replace } : {}),
          })
          .then((r) =>
            fromResult(r, `Set ${Object.keys(args.entries).length} string(s) in "${args.locale}".`),
          ),
    },

    {
      name: 'add_locale',
      config: {
        title: 'Add a language',
        description: 'Creates an empty overlay. Untranslated keys fall back to the default locale.',
        inputSchema: { id: z.string(), label: z.string() },
      },
      writes: true,
      run: (args: { id: string; label: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'locale.add', id: args.id, label: args.label })
          .then((r) => fromResult(r, `Added locale "${args.id}".`)),
    },

    {
      name: 'set_connection',
      config: {
        title: 'Label a connection, and say how it is drawn',
        description:
          'What makes this connection happen — "ok", "wrong password", "no worker". ' +
          'Labels are not decoration: the layout reads them to decide which branch is the ' +
          'way through, so a labelled failure drops below the main line instead of taking ' +
          'it. Omit `label` to clear it, which marks the plain next step. ' +
          'The line itself can say something too, on a map too big for a legend: `width` ' +
          'for the path most people take, `dash` for a route taken sometimes rather than ' +
          'always, `color` to tell one journey from another. `color` is any CSS colour and ' +
          'NOT a design token — the canvas is chrome around the design, so the design’s ' +
          'variables do not resolve out here. ' +
          'Line properties merge with what is already set; pass width 0 to clear them all.',
        inputSchema: {
          id: z.string(),
          label: z.string().optional(),
          width: z.number().optional(),
          color: z.string().optional(),
          dash: z.boolean().optional(),
        },
      },
      writes: true,
      run: (
        args: { id: string; label?: string; width?: number; color?: string; dash?: boolean },
        ctx: ToolContext,
      ) => {
        /* Merged onto what the edge already has, so setting a colour does not
         * silently drop a width somebody set earlier — the same reasoning as
         * a variant's fields. */
        const before = ctx.store.get().flow.edges[args.id]?.style;
        const style =
          args.width === 0
            ? undefined
            : {
                ...before,
                ...(args.width !== undefined ? { width: args.width } : {}),
                ...(args.color !== undefined ? { color: args.color } : {}),
                ...(args.dash !== undefined ? { dash: args.dash } : {}),
              };
        const touchesLine =
          args.width !== undefined || args.color !== undefined || args.dash !== undefined;

        return ctx.store
          .run({
            t: 'edge.update',
            id: args.id,
            ...(args.label !== undefined ? { label: args.label } : {}),
            ...(touchesLine && style ? { style } : {}),
          })
          .then((r) =>
            fromResult(
              r,
              args.label === undefined && !touchesLine
                ? `Cleared the label on ${args.id}.`
                : `Updated ${args.id}.`,
            ),
          );
      },
    },

    {
      name: 'set_flow',
      config: {
        title: 'Create or rename a flow',
        description:
          'A flow is a named journey — screens can belong to several. It is what the canvas ' +
          'filter switches between and what the layout arranges as one band. Setting an id ' +
          'that already exists renames it. ' +
          'Pass arrange="row" for a flow that is a SHEET rather than a journey — reference ' +
          'pages, or a bench of screens being worked on — and its screens are laid side by ' +
          'side in the order they carry instead of following the connections.',
        inputSchema: {
          id: z.string(),
          label: z.string(),
          arrange: z.enum(['flow', 'row']).optional(),
        },
      },
      writes: true,
      run: (args: { id: string; label: string; arrange?: 'flow' | 'row' }, ctx: ToolContext) => {
        /* Merged onto the flow that is already there.
         *
         * `group.set` writes a WHOLE group, which is what undo needs, so a tool
         * that built one from its arguments alone silently dropped everything
         * it had no argument for: renaming the kit flow took away the `row`
         * arrangement it is laid out with, and its screens scattered. */
        const before = ctx.store.get().flow.groups.find((g) => g.id === args.id);
        return ctx.store
          .run({
            t: 'group.set',
            group: {
              ...before,
              id: args.id,
              label: args.label,
              ...(args.arrange ? { arrange: args.arrange } : {}),
            },
          })
          .then((r) => fromResult(r, `Flow "${args.id}" is "${args.label}".`));
      },
    },

    {
      name: 'delete_flow',
      config: {
        title: 'Remove a flow',
        description:
          'Removes the flow itself. The screens in it stay — they simply stop belonging to ' +
          'it, and show only under "all".',
        inputSchema: { id: z.string() },
      },
      writes: true,
      run: (args: { id: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'group.delete', id: args.id })
          .then((r) => fromResult(r, `Removed flow "${args.id}".`)),
    },

    {
      name: 'rename_item',
      config: {
        title: 'Rename an item',
        description:
          'The name is the identity — nodes pointing at it and any `<x-name>` using it move ' +
          'with it, in one step.',
        inputSchema: { from: z.string(), to: z.string() },
      },
      writes: true,
      run: (args: { from: string; to: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'item.rename', from: args.from, to: args.to })
          .then((r) => fromResult(r, `"${args.from}" is now "${args.to}".`)),
    },

    {
      name: 'remove_locale',
      config: {
        title: 'Remove a language',
        description:
          'Drops a language and its translations. The default locale cannot be removed — it ' +
          'is what every screen falls back to.',
        inputSchema: { id: z.string() },
      },
      writes: true,
      run: (args: { id: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'locale.delete', id: args.id })
          .then((r) => fromResult(r, `Removed "${args.id}".`)),
    },

    {
      name: 'rename_project',
      config: {
        title: 'Rename the project',
        description: 'The display name. The id and the file stay as they are.',
        inputSchema: { name: z.string() },
      },
      writes: true,
      run: (args: { name: string }, ctx: ToolContext) =>
        ctx.store
          .run({ t: 'project.rename', name: args.name })
          .then((r) => fromResult(r, `Renamed to "${args.name}".`)),
    },

    {
      name: 'rearrange',
      config: {
        title: 'Lay the canvas out from the connections',
        description:
          'Discards hand placement and re-places screens from the graph: the main path along ' +
          'one lane left to right, branches dropping below, and every connection travelling ' +
          'through a clear corridor so none is hidden under a screen. The way back from a ' +
          'mess, in one undo step. Name a flow to leave the rest of the canvas alone. ' +
          'Name a `viewport` to arrange only how it looks at that size, leaving the others as ' +
          'they are; omit it and the shared placement is rewritten and every per-viewport ' +
          'arrangement in scope is dropped — which is what a reset has to mean.',
        inputSchema: { group: z.string().optional(), viewport: z.string().optional() },
      },
      writes: true,
      run: (args: { group?: string; viewport?: string }, ctx: ToolContext) =>
        ctx.store
          .run({
            t: 'flow.arrange',
            ...(args.group !== undefined ? { group: args.group } : {}),
            ...(args.viewport !== undefined ? { viewport: args.viewport } : {}),
          })
          .then((r) =>
            fromResult(
              r,
              `Rearranged ${args.group ? `"${args.group}"` : 'the canvas'}` +
                `${args.viewport ? ` for ${args.viewport}` : ''}.`,
            ),
          ),
    },

    {
      name: 'undo',
      config: {
        title: 'Undo the last change',
        description: 'Reverts the most recent write, whoever made it.',
        inputSchema: {},
      },
      writes: true,
      run: async (_args: never, ctx: ToolContext): Promise<ToolReply> => {
        const result = await ctx.store.undo();
        if (!result) return text('Nothing to undo.');
        return fromResult(result, 'Undone.');
      },
    },

    {
      name: 'batch',
      config: {
        title: 'Run several edits as one change',
        description:
          'A list of ordinary tool calls, applied as ONE transaction with ONE undo — for ' +
          'mass edits: rename twenty items, create a flow of screens and connect them, ' +
          'repoint every node. Each step is {tool, args}, exactly the tool name and arguments ' +
          'you would call on their own; later steps SEE the earlier ones (create then rename ' +
          'works). If any step is rejected, nothing is written and the reply says which. ' +
          'The whole result is validated together at the end, so intermediate states that a ' +
          'single call would reject — a key stamped before its string exists — are fine here. ' +
          'Only editing tools are allowed, not renders, exports or undo; batch cannot nest.',
        inputSchema: {
          calls: z
            .array(
              z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).optional() }),
            )
            .describe('Steps in order, e.g. [{tool:"rename_item", args:{from:"a", to:"b"}}].'),
        },
      },
      writes: true,
      run: (
        args: { calls: { tool: string; args?: Record<string, unknown> }[] },
        ctx: ToolContext,
      ) => runBatch(args.calls, ctx),
    },
  ];
}

/** Tools that may appear inside `batch`: the structural editors, which touch
 *  nothing but the store. Renders, exports, undo, and anything doing I/O or
 *  needing the sidecar are left out — batch collects commands, it cannot carry
 *  a browser or a network fetch through the transaction. */
const BATCHABLE = new Set([
  'create_item',
  'duplicate_item',
  'set_item_html',
  'set_item_css',
  'set_item_meta',
  'rename_item',
  'delete_item',
  'set_variant',
  'delete_variant',
  'set_default_variant',
  'extract_component',
  'add_node',
  'update_node',
  'delete_node',
  'clear_placement',
  'connect',
  'disconnect',
  'set_connection',
  'set_flow',
  'delete_flow',
  'rearrange',
  'set_strings',
  'add_locale',
  'remove_locale',
  'set_token',
  'remove_token',
  'add_theme',
  'delete_theme',
  'set_default_theme',
  'set_base',
  'update_item_sheets',
  'set_sheet',
  'delete_sheet',
  'rename_project',
]);

/** Apply a list of tool calls against a scratch document, then commit the
 *  commands they produced as one transaction. The scratch mirrors the store's
 *  own runAll semantics — each step is applied with NONE so a half-finished
 *  document is not judged, and the whole is validated once at commit. */
async function runBatch(
  calls: { tool: string; args?: Record<string, unknown> }[],
  ctx: ToolContext,
): Promise<ToolReply> {
  if (calls.length === 0) return text('Nothing to do — no steps.');

  let workdoc = ctx.store.get();
  const commands: Command[] = [];

  // A store the sub-tools write THROUGH: it applies to the scratch doc so a
  // later step sees an earlier one, records the commands, and answers in the
  // CommandResult shape the tools expect back.
  const scratch = {
    get: () => workdoc,
    run: (cmd: Command) => {
      const r = apply(workdoc, cmd, { rules: NONE.rules });
      if (r.ok && r.doc) {
        workdoc = r.doc;
        commands.push(cmd);
      }
      return Promise.resolve(r);
    },
    runAll: (cmds: readonly Command[]) => {
      const r = applyAll(workdoc, cmds, { rules: NONE.rules });
      if (r.ok && r.doc) {
        workdoc = r.doc;
        commands.push(...cmds);
      }
      return Promise.resolve(r);
    },
  };
  const subCtx: ToolContext = {
    id: ctx.id,
    path: ctx.path,
    progress: () => undefined,
    store: scratch as unknown as ToolContext['store'],
  };

  for (const [i, call] of calls.entries()) {
    const where = `step ${i + 1} (${call.tool})`;
    if (call.tool === 'batch') return failure(`${where}: batch cannot contain batch.`);
    if (!BATCHABLE.has(call.tool)) {
      return failure(
        `${where}: "${call.tool}" cannot run inside batch. Batchable tools edit the document ` +
          'only — renders, exports and undo are not among them. Nothing was written.',
      );
    }
    const spec = writeToolSpecs.get(call.tool);
    if (!spec) return failure(`${where}: no tool named "${call.tool}".`);

    const reply = (await spec.run((call.args ?? {}) as never, subCtx)) as ToolReply;
    if (reply.isError) {
      const detail = reply.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ');
      return failure(`${where} was rejected, so nothing in the batch was written:\n\n${detail}`);
    }
  }

  if (commands.length === 0) return text('The steps produced no changes.');

  // One real transaction: the store validates the END state and records a
  // single undo for the whole batch.
  const result = await ctx.store.runAll(commands);
  return fromResult(
    result,
    `Ran ${calls.length} step(s) as one change — ${commands.length} command(s), one undo.`,
  );
}

/** Placement from whichever dialect the caller used.
 *
 *  Pixels are a convenience, not the storage: they only mean something next to
 *  a viewport, so converting needs one — and half a pixel pair is a mistake
 *  worth naming rather than silently treating the other half as zero. */
/** Free-form meta, merged rather than replaced.
 *
 *  Replacing would make every note a read-modify-write, and the first time
 *  somebody forgot the read they would silently erase what was there. A key
 *  set to null is how you take one back out. */
/** Refuses the one tier change that quietly breaks the canvas: taking a screen
 *  that nodes point at and making it something a node may not point at. Returns
 *  a failure reply to send back, or undefined when the change is safe. */
function tierGuard(
  doc: ReturnType<ToolContext['store']['get']>,
  name: string,
  tier: string | undefined,
): ToolReply | undefined {
  const item = doc.items[name];
  if (tier === undefined || tier === 'screen' || item?.tier !== 'screen') return undefined;

  const nodes = Object.entries(doc.flow.nodes)
    .filter(([, node]) => node.screen === name)
    .map(([id]) => id);
  if (nodes.length === 0) return undefined;

  return failure(
    `"${name}" is a screen that ${nodes.length} node(s) on the canvas point at ` +
      `(${nodes.slice(0, 6).join(', ')}) — making it a ${tier} would leave them pointing at ` +
      'nothing. Repoint or delete those nodes first, or keep it a screen.',
  );
}

function merged(
  before: Record<string, unknown> | undefined,
  given: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(given)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

/** The thing that was invisible: a node placed for a viewport keeps that
 *  placement even after the shared col/lane is changed, so a base move can look
 *  like it did nothing on the size someone is actually looking at. Setting the
 *  shared placement while such overrides exist says so, and names them. */
function placementNote(
  args: { id: string; viewport?: string; col?: number; lane?: number; x?: number; y?: number },
  ctx: ToolContext,
): string {
  const movedBase =
    args.viewport === undefined &&
    (args.col !== undefined ||
      args.lane !== undefined ||
      args.x !== undefined ||
      args.y !== undefined);
  if (!movedBase) return '';

  const cells = Object.keys(ctx.store.get().flow.nodes[args.id]?.cells ?? {});
  if (cells.length === 0) return '';
  return (
    ` NOTE: this set the SHARED placement, but it also has its own on ${cells.join(', ')}, ` +
    `which still wins there — that is what the canvas shows if you are looking at one of them. ` +
    `Pass viewport=<id> to move it on that size, or clear_placement to drop the override.`
  );
}

function cellFrom(
  args: { id?: string; col?: number; lane?: number; x?: number; y?: number; viewport?: string },
  ctx: ToolContext,
): { patch: { col?: number; lane?: number; cells?: Record<string, Cell> } } | { error: string } {
  const doc = ctx.store.get();

  /* Named viewport, named placement.
   *
   * Grid units were supposed to mean the same thing at every size, and they do
   * not: a column is a screen width and a lane a screen height, so the same
   * cell is 570px across on a phone and 1620 on a desktop while barely moving
   * down. So a placement made while looking at one viewport is stored for that
   * viewport, and col/lane stays the shared default for the ones nobody has
   * arranged. */
  const scoped = (cell: Cell): { col?: number; lane?: number; cells?: Record<string, Cell> } => {
    if (args.viewport === undefined) return cell;
    const before = args.id ? doc.flow.nodes[args.id]?.cells : undefined;
    return { cells: { ...before, [args.viewport]: cell } };
  };

  if (args.col !== undefined || args.lane !== undefined) {
    if (args.viewport !== undefined) {
      if (args.col === undefined || args.lane === undefined) {
        return { error: 'Give both col and lane when placing for one viewport.' };
      }
      return { patch: scoped({ col: args.col, lane: args.lane }) };
    }
    return {
      patch: {
        ...(args.col !== undefined ? { col: args.col } : {}),
        ...(args.lane !== undefined ? { lane: args.lane } : {}),
      },
    };
  }
  if (args.x === undefined && args.y === undefined) return { patch: {} };
  if (args.x === undefined || args.y === undefined) {
    return { error: 'Give both x and y, or use col/lane.' };
  }

  const size = doc.viewports.find((v) => v.id === args.viewport) ?? doc.viewports[0];
  if (!size) return { error: 'This project has no viewports, so pixels mean nothing here.' };

  return { patch: scoped(toCell({ x: args.x, y: args.y }, size)) };
}
