/* Read tools.
 *
 * These decide token cost more than anything else in the server. `overview`
 * and `list_items` are deliberately terse — names and one line each — so a
 * model can find what it needs and only then pay for the full item. The whole
 * registry must never end up in a prompt.
 */

import type { Tier } from '@flowkit/core';
import {
  getItem,
  listEdges,
  listItems,
  listNodes,
  placementOf,
  projectCoverage,
  toPoint,
  validate,
} from '@flowkit/core';
import type { Workspace } from '@flowkit/host';
import { z } from 'zod';
import { failure, type ToolReply, text } from '../reply';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

const TIERS = ['element', 'component', 'container', 'screen', 'layout'] as const;

export function registerReadTools(server: Registrar, ws: Workspace): void {
  register(server, ws, tools());
}

function tools(): ToolSpec[] {
  return [
    {
      name: 'overview',
      config: {
        title: 'Project overview',
        description:
          'Counts, flows, themes, locales and viewports. Start here — it is the cheapest ' +
          'way to see what the project contains.',
        inputSchema: {},
      },
      run: (_args: never, ctx: ToolContext): ToolReply => {
        const doc = ctx.store.get();
        const items = Object.values(doc.items);
        const byTier = TIERS.map(
          (tier) => `${tier}: ${items.filter((i) => i.tier === tier).length}`,
        ).join(', ');
        const errors = validate(doc).filter((d) => d.severity === 'error').length;

        return text(
          [
            `${doc.name} (schema ${doc.schema}, updated ${doc.updatedAt})`,
            `items      ${items.length} — ${byTier}`,
            `flow       ${Object.keys(doc.flow.nodes).length} nodes, ` +
              `${Object.keys(doc.flow.edges).length} edges`,
            `groups     ${doc.flow.groups.map((g) => `${g.id} (${g.label})`).join(', ') || '—'}`,
            `themes     ${Object.keys(doc.kit.themes).join(', ')} (default ${doc.kit.defaultTheme})`,
            `locales    ${Object.keys(doc.strings.locales).join(', ')} ` +
              `(default ${doc.strings.defaultLocale})`,
            `viewports  ${doc.viewports.map((v) => `${v.id} ${v.width}x${v.height}`).join(', ')}`,
            `strings    ${Object.keys(doc.strings.locales[doc.strings.defaultLocale]?.entries ?? {}).length} keys`,
            `sheets     ${Object.keys(doc.kit.sheets).join(', ') || '—'}`,
            `coverage   ${(projectCoverage(doc) * 100).toFixed(1)}% composed ` +
              '(share of elements that come from the registry)',
            `problems   ${errors} error(s) — run validate for detail`,
          ].join('\n'),
        );
      },
    },

    {
      name: 'list_items',
      config: {
        title: 'List items',
        description: 'Names and one line each. Cheap. Use get_item for the full markup of one.',
        inputSchema: { tier: z.enum(TIERS).optional() },
      },
      run: ({ tier }: { tier?: Tier }, ctx: ToolContext): ToolReply => {
        const rows = listItems(ctx.store.get(), tier);
        if (rows.length === 0) return text('No items.');
        return text(
          rows
            .map(
              (i) =>
                `${i.name}  [${i.tier}]${i.opaque ? ' opaque' : ''}` +
                `${i.props.length > 0 ? `  props: ${i.props.join(', ')}` : ''}` +
                `${i.fixtures.length > 1 ? `  fixtures: ${i.fixtures.join(', ')}` : ''}` +
                `${i.description ? `\n    ${i.description}` : ''}`,
            )
            .join('\n'),
        );
      },
    },

    {
      name: 'get_item',
      config: {
        title: 'Get one item',
        description: 'Full markup, CSS, props and fixtures for a single item.',
        inputSchema: { name: z.string() },
      },
      run: ({ name }: { name: string }, ctx: ToolContext): ToolReply => {
        const item = getItem(ctx.store.get(), name);
        if (!item) {
          return failure(`No item named "${name}". Use list_items to see what exists.`);
        }
        return text(
          [
            `${name}  [${item.tier}]`,
            item.description ? `description: ${item.description}` : '',
            item.sheets ? `sheets: ${item.sheets.join(', ')}` : '',
            item.rootAttrs
              ? `rootAttrs: ${Object.entries(item.rootAttrs)
                  .map(([k, v]) => `${k}="${v}"`)
                  .join(' ')}`
              : '',
            `fixtures: ${Object.keys(item.fixtures).join(', ')}`,
            '',
            '--- html ---',
            item.html,
            ...(item.css ? ['', '--- css ---', item.css] : []),
          ]
            .filter((line) => line !== '')
            .join('\n'),
        );
      },
    },

    {
      name: 'list_nodes',
      config: {
        title: 'List canvas nodes',
        description:
          'Every node on the canvas: which screen it shows, its flow, and where it sits. ' +
          'Position is col/lane — one column is a screen width plus the corridor beside it, ' +
          'one lane is a screen height plus room for its captions — and also pixels and size ' +
          'for the viewport asked about. PLACE THINGS BY col/lane, never by pixels — a column ' +
          'is a screen width and a lane a screen height, so the same cell means the same thing ' +
          'wherever it is read. A screen placed FOR this viewport reports that placement; the ' +
          'rest report the shared one. A cell marked (auto) is where the layout put it, not a ' +
          'placement anyone chose.',
        inputSchema: { group: z.string().optional(), viewport: z.string().optional() },
      },
      run: ({ group, viewport }: { group?: string; viewport?: string }, ctx: ToolContext) => {
        const doc = ctx.store.get();
        const rows = listNodes(doc).filter(
          (n) => group === undefined || (n.groups ?? []).includes(group),
        );
        if (rows.length === 0) return text('No nodes.');

        const size = doc.viewports.find((v) => v.id === viewport) ?? doc.viewports[0];
        if (!size) return failure('This project has no viewports.');

        // Cells for EVERY node, arranged where none was stored — otherwise a
        // freshly imported project reports everything at the origin, which is
        // both wrong and unusable for placing anything relative to it.
        const cells = placementOf(doc.flow, size.id);

        return text(
          [
            `Viewport ${size.id} — ${size.width}x${size.height} per screen.`,
            ...rows.map((n) => {
              const cell = cells[n.id] ?? { col: 0, lane: 0 };
              const at = toPoint(cell, size);
              const node = doc.flow.nodes[n.id];
              /* Where the shown cell CAME FROM, because that decides how to
               * move it: a placement made for THIS viewport is changed by
               * naming the viewport, the shared one without, and an arranged
               * cell is not stored at all. Silence here is what let a base
               * move look like it did nothing. */
              const others = Object.keys(node?.cells ?? {}).filter((v) => v !== size.id);
              const source = node?.cells?.[size.id]
                ? `(${size.id})`
                : node?.col !== undefined
                  ? '(shared)'
                  : '(auto)';
              return (
                `${n.id}  screen=${n.screen}  fixture=${n.fixture}` +
                `${n.groups?.length ? `  groups=${n.groups.join('/')}` : ''}` +
                `${n.order !== undefined ? `  order=${n.order}` : ''}` +
                `  col ${cell.col} lane ${cell.lane} ${source}` +
                `${others.length > 0 ? ` also on: ${others.join(', ')}` : ''}` +
                `  [x=${Math.round(at.x)} y=${Math.round(at.y)} w=${size.width} h=${size.height}]` +
                `${n.title ? `  "${n.title}"` : ''}`
              );
            }),
          ].join('\n'),
        );
      },
    },

    {
      name: 'list_edges',
      config: {
        title: 'List connections',
        description: 'Screen-to-screen connections on the canvas.',
        inputSchema: {},
      },
      run: (_args: never, ctx: ToolContext): ToolReply => {
        const rows = listEdges(ctx.store.get());
        if (rows.length === 0) return text('No connections.');
        return text(
          rows
            .map((e) => `${e.id}  ${e.from} -> ${e.to}${e.label ? `  "${e.label}"` : ''}`)
            .join('\n'),
        );
      },
    },

    {
      name: 'get_tokens',
      config: {
        title: 'Get design tokens',
        description:
          'CSS custom properties for a theme. These are the ONLY place colours and ' +
          'sizes may come from — item CSS must reference them with var(--x).',
        inputSchema: { theme: z.string().optional() },
      },
      run: ({ theme }: { theme?: string }, ctx: ToolContext): ToolReply => {
        const doc = ctx.store.get();
        const id = theme ?? doc.kit.defaultTheme;
        const found = doc.kit.themes[id];
        if (!found) {
          return failure(`No theme "${id}". Available: ${Object.keys(doc.kit.themes).join(', ')}.`);
        }
        return text(
          [
            `theme ${id} (${found.label})`,
            ...Object.entries(found.tokens).map(([k, v]) => `  ${k}: ${v};`),
          ].join('\n'),
        );
      },
    },

    {
      name: 'validate',
      config: {
        title: 'Validate the project',
        description:
          'Every problem in the document — hardcoded colours, unknown tokens, text with ' +
          'no translation key, tokens missing from a theme.',
        inputSchema: {},
      },
      run: (_args: never, ctx: ToolContext): ToolReply => {
        const found = validate(ctx.store.get());
        if (found.length === 0) return text('No problems.');
        const errors = found.filter((d) => d.severity === 'error');
        const warnings = found.filter((d) => d.severity === 'warning');
        return text(
          [
            `${errors.length} error(s), ${warnings.length} warning(s)`,
            '',
            ...found
              .slice(0, 60)
              .map(
                (d) =>
                  `[${d.severity}] [${d.code}]${d.item ? ` ${d.item}` : ''}` +
                  `${d.line ? `:${d.line}` : ''} — ${d.message}`,
              ),
            found.length > 60 ? `\n…and ${found.length - 60} more.` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      },
    },
  ];
}
