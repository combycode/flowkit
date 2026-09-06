/* render_screen and render_map — the tools that let a model see what it built.
 *
 * Without it, editing markup is editing blind: the HTML can be perfectly
 * valid and the layout still broken, and no amount of reading the source
 * reveals text that overflows, a button that wrapped, or contrast that
 * vanished. This closes the loop — write, render, look, fix.
 *
 * Returns a real MCP image part, not a file path, so the picture goes
 * straight into the model's context.
 */

import { composeDocument } from '@flowkit/core';
import type { Sidecar } from '@flowkit/host';
import { mapPage, READY_FLAG, type Workspace } from '@flowkit/host';
import { z } from 'zod';
import { failure, type ToolReply } from '../reply';
import { type Registrar, registerBare, type ToolSpec } from './registrar';

export function registerRenderTools(server: Registrar, ws: Workspace, sidecar: Sidecar): void {
  registerBare(server, tools(ws, sidecar));
}

interface RenderArgs {
  screen?: string;
  node?: string;
  project?: string;
  theme?: string;
  locale?: string;
  viewport?: string;
  scale?: number;
}

function tools(ws: Workspace, sidecar: Sidecar): ToolSpec[] {
  return [
    {
      name: 'render_screen',
      config: {
        title: 'Render a screen to an image',
        description:
          'Renders a screen exactly as it will ship and returns the picture. Use it after ' +
          'changing markup or CSS — valid HTML can still be a broken layout, and only the ' +
          'render shows overflowing text, a wrapped button or lost contrast. ' +
          'Name either a screen item or a canvas node.',
        inputSchema: {
          screen: z.string().optional(),
          node: z.string().optional(),
          project: z.string().optional(),
          theme: z.string().optional(),
          locale: z.string().optional(),
          viewport: z.string().optional(),
          scale: z.number().optional(),
        },
      },
      run: async (args: RenderArgs): Promise<ToolReply> => {
        const { id, store } = await ws.require(args.project);
        const doc = store.get();

        // A node carries its own theme/locale/viewport choices, so rendering
        // one means rendering what is actually on the canvas rather than a
        // guess at how it is configured.
        const node = args.node ? doc.flow.nodes[args.node] : undefined;
        if (args.node && !node) {
          return failure(`No node "${args.node}" in ${id}. Use list_nodes to see what exists.`);
        }

        const item = args.screen ?? node?.screen;
        if (!item) {
          return failure('Name a screen or a node to render.');
        }
        if (!doc.items[item]) {
          return failure(`No item "${item}" in ${id}. Use list_items to see what exists.`);
        }

        const viewportId = args.viewport ?? node?.viewport ?? doc.viewports[0]?.id ?? 'mobile';
        const viewport = doc.viewports.find((v) => v.id === viewportId);
        if (!viewport) {
          return failure(
            `No viewport "${viewportId}". Available: ${doc.viewports.map((v) => v.id).join(', ')}.`,
          );
        }

        const theme = args.theme ?? doc.kit.defaultTheme;
        const locale = args.locale ?? doc.strings.defaultLocale;
        const { html } = composeDocument({
          doc,
          item,
          ctx: { theme, locale, viewport: viewportId, ...(node ? { fixture: node.fixture } : {}) },
        });

        /* A screen that measured itself is rendered at that size, whatever
         * viewport was asked for: naming one chooses the CONTEXT it composes
         * in — which is what a kit sheet reads to draw its frames at the size
         * being looked at — not the size of the sheet, which is its own. */
        const own = doc.items[item]?.size;
        const size = own ?? viewport;

        const shot = await sidecar.render({
          html,
          width: size.width,
          height: size.height,
          // 1x by default: image cost scales with pixels and models downscale
          // large images anyway, so 2x doubles the tokens for no more detail.
          scale: args.scale ?? 1,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                `${item} — ${id}, ${theme}, ${locale}, ${own ? `own size, ${viewport.label} context` : viewport.label} ` +
                `${shot.width}x${shot.height} (${shot.ms} ms)`,
            },
            { type: 'image', data: shot.data, mimeType: 'image/png' },
          ] as ToolReply['content'],
        };
      },
    },

    {
      name: 'render_map',
      config: {
        title: 'Render the canvas as a picture',
        description:
          'The whole canvas as one image: every screen where it actually sits, with the ' +
          'connections drawn between them and their labels. Use it to judge the SHAPE of a ' +
          'design — whether a branch reads as a branch, whether a flow is a straight line or ' +
          'a thicket, whether a screen has been left stranded. list_nodes gives coordinates; ' +
          'only this shows what they add up to. ' +
          'Narrow it with `group`, or with a `region` in the pixel coordinates list_nodes ' +
          'reports. Everything is a knob: theme, locale, viewport, scale.',
        inputSchema: {
          project: z.string().optional(),
          group: z.string().optional(),
          theme: z.string().optional(),
          locale: z.string().optional(),
          viewport: z.string().optional(),
          region: z
            .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
            .optional(),
          scale: z.number().optional(),
          labels: z.boolean().optional(),
        },
      },
      run: async (args: MapArgs): Promise<ToolReply> => {
        const { id, store } = await ws.require(args.project);
        const doc = store.get();

        if (args.group !== undefined && !doc.flow.groups.some((g) => g.id === args.group)) {
          return failure(
            `No flow "${args.group}" in ${id}. ` +
              `Available: ${doc.flow.groups.map((g) => g.id).join(', ') || 'none'}.`,
          );
        }
        const viewportId = args.viewport ?? doc.viewports[0]?.id ?? 'mobile';
        if (!doc.viewports.some((v) => v.id === viewportId)) {
          return failure(
            `No viewport "${viewportId}". Available: ${doc.viewports.map((v) => v.id).join(', ')}.`,
          );
        }

        const theme = args.theme ?? doc.kit.defaultTheme;
        const locale = args.locale ?? doc.strings.defaultLocale;
        const map = mapPage({
          doc,
          ctx: { theme, locale, viewport: viewportId },
          ...(args.group !== undefined ? { group: args.group } : {}),
          ...(args.labels !== undefined ? { labels: args.labels } : {}),
        });

        if (map.screens === 0) {
          return failure(
            args.group ? `Nothing on the canvas in "${args.group}".` : 'Nothing on the canvas.',
          );
        }

        // A region is given in the same pixel coordinates list_nodes reports,
        // which are absolute on the canvas; the page starts at the map's own
        // top-left, so it has to be moved into page space.
        const clip = args.region
          ? {
              x: args.region.x - map.bounds.x,
              y: args.region.y - map.bounds.y,
              width: args.region.width,
              height: args.region.height,
            }
          : { x: 0, y: 0, width: map.bounds.width, height: map.bounds.height };

        // A whole map is thousands of pixels across. Fitting it to something a
        // model can actually read costs nothing extra to compute and saves the
        // tokens an oversized image would burn, so the default scale FITS
        // rather than being 1.
        const scale = args.scale ?? fitScale(clip.width, clip.height);

        const shot = await sidecar.render({
          html: map.html,
          // The layout viewport only has to be big enough to exist: the map is
          // absolutely positioned at fixed sizes, and each screen reports its
          // own metrics to its own media queries from inside its frame.
          width: Math.min(2000, Math.ceil(clip.width)),
          height: Math.min(2000, Math.ceil(clip.height)),
          clip,
          scale,
          scrollToEnd: false,
          waitFor: `window.${READY_FLAG}`,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                `${id} — ${args.group ?? 'all flows'}, ${map.screens} screens, ` +
                `${map.edges} connections, ${theme}, ${locale}, ${viewportId}. ` +
                `Image ${shot.width}x${shot.height} at ${scale.toFixed(2)}x (${shot.ms} ms). ` +
                `Map occupies x=${Math.round(map.bounds.x)} y=${Math.round(map.bounds.y)} ` +
                `w=${Math.round(map.bounds.width)} h=${Math.round(map.bounds.height)} ` +
                `in canvas pixels; pass a region in those coordinates to look closer.`,
            },
            { type: 'image', data: shot.data, mimeType: 'image/png' },
          ] as ToolReply['content'],
        };
      },
    },
  ];
}

interface MapArgs {
  project?: string;
  group?: string;
  theme?: string;
  locale?: string;
  viewport?: string;
  region?: { x: number; y: number; width: number; height: number };
  scale?: number;
  labels?: boolean;
}

/** Shrink a large map to something worth sending, and never enlarge a small
 *  one. The cap is on the longest side, because a tall flow and a wide one
 *  both have to arrive readable. */
function fitScale(width: number, height: number): number {
  const LONGEST = 2400;
  return Math.min(1, LONGEST / Math.max(width, height));
}
