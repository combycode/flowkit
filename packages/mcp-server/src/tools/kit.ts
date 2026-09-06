/* build_kit — the design system, drawn from the registry.
 *
 * Colour, type, spacing and every component with its variants, as ordinary
 * screens in the project: they sit on the canvas, they export as PNG and HTML
 * with everything else, and `get_item` shows exactly what is there.
 *
 * They are GENERATED, so running this again is how they stay true. The
 * component page references items through the composer rather than describing
 * them, which means it cannot show a button that no longer looks like that —
 * it is the same button. `validate` reports a page that has fallen behind,
 * because a kit picturing a design system that no longer exists is worse than
 * having no kit at all.
 */

import type { Command, ProjectDoc } from '@flowkit/core';
import {
  composeDocument,
  KIT_GENERATOR,
  KIT_GROUP,
  KIT_SHEET,
  kitPages,
  kitSheet,
  registryItems,
  sheetWidth,
} from '@flowkit/core';
import type { Sidecar, Workspace } from '@flowkit/host';
import { z } from 'zod';
import { fromResult, type ToolReply, text } from '../reply';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

export function registerKitTools(server: Registrar, ws: Workspace, sidecar: Sidecar): void {
  register(server, ws, tools(sidecar));
}

/** How wide a kit sheet is drawn: wide enough for a grid of variants, and for
 *  a shell frame at the widest viewport the project has — see sheetWidth. */
/** Enough that the shortest sheet still looks like a page rather than a strip. */
const KIT_MIN_HEIGHT = 700;
/** The viewport a kit page is composed against — a real one, so its media
 *  queries are the desktop ones. */
const KIT_VIEWPORT = 'desktop';

/** The viewport a sheet is MEASURED at: the tallest the project has.
 *
 *  A shell is drawn in a frame the size of whatever viewport is being looked
 *  at, so the sheet is at its longest under the tallest one. Measured at any
 *  other, the stored size would be too short and an export of it would come
 *  back cut off — for one viewport only, which is the kind of bug nobody
 *  reproduces. */
function tallest(doc: ProjectDoc): string {
  return [...doc.viewports].sort((a, b) => b.height - a.height)[0]?.id ?? KIT_VIEWPORT;
}

function tools(sidecar: Sidecar): ToolSpec[] {
  return [
    {
      name: 'build_kit',
      config: {
        title: 'Draw the design system from the registry',
        description:
          'Generates the kit sheets — foundation (colour, type, sizes, icons), then one per ' +
          'tier for whatever is in the registry: elements, components, layouts — and puts ' +
          'them on the canvas in their own flow, side by side. Each sheet MEASURES itself, ' +
          'so it exports whole rather than as its first screenful. They export with the ' +
          'other screens; they are left off the flow map, which is about journeys. ' +
          'Run it again whenever the registry changes: the pages are generated, not authored, ' +
          'and editing them by hand is pointless because the next build overwrites it. ' +
          'The component page renders the real items through the composer, so it cannot show ' +
          'something the screens do not.',
        inputSchema: { onCanvas: z.boolean().optional() },
      },
      writes: true,
      run: async (args: { onCanvas?: boolean }, ctx: ToolContext): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const pages = kitPages(doc);
        const parts = registryItems(doc);

        /* One sheet list for every kit page, or they drift. The component page
         * composes real components and so pulls in whatever THEY need — in
         * STRAIW that includes the sheet whose own comment says it is "loaded
         * by every page so nothing anywhere falls back to a native bar". The
         * colour page beside it loaded none of that, so two pages of the same
         * kit had different scrollbars. */
        const sheets = [
          KIT_SHEET,
          ...new Set(parts.flatMap((name) => doc.items[name]?.sheets ?? [])),
        ];

        const commands: Command[] = [
          { t: 'sheet.set', name: KIT_SHEET, css: kitSheet() },
          // Side by side, not stacked: the kit is a sheet, not a journey.
          { t: 'group.set', group: { id: KIT_GROUP, label: 'Kit', arrange: 'row' } },
        ];

        for (const [index, page] of pages.entries()) {
          const before = doc.items[page.name];

          commands.push(
            before
              ? {
                  t: 'item.replace',
                  name: page.name,
                  item: {
                    ...before,
                    html: page.html,
                    sheets,
                    description: page.description,
                    generated: KIT_GENERATOR,
                    // Its own viewport, sized below to the tallest of them.
                    viewport: KIT_VIEWPORT,
                  },
                }
              : {
                  t: 'item.create',
                  name: page.name,
                  tier: 'screen',
                  html: page.html,
                  description: page.description,
                },
          );

          if (!before) {
            commands.push({
              t: 'item.replace',
              name: page.name,
              item: {
                tier: 'screen',
                html: page.html,
                props: {},
                fixtures: { default: { values: {} } },
                sheets,
                description: page.description,
                generated: KIT_GENERATOR,
                viewport: KIT_VIEWPORT,
              },
            });
          }

          /* A node that already exists keeps where somebody put it — but not
           * its size: the kit viewport is measured on every build, and a page
           * left on the old one is drawn in a frame that cuts it off. */
          const node = doc.flow.nodes[page.name];
          if (node && node.viewport !== KIT_VIEWPORT) {
            commands.push({
              t: 'node.update',
              id: page.name,
              patch: { viewport: KIT_VIEWPORT },
            });
          }

          // On the canvas so it can be looked at, in its own flow so it never
          // clutters a journey.
          if ((args.onCanvas ?? true) && !node) {
            commands.push({
              t: 'node.add',
              id: page.name,
              node: {
                screen: page.name,
                fixture: 'default',
                title: page.title,
                description: page.description,
                groups: [KIT_GROUP],
                order: index + 1,
                viewport: KIT_VIEWPORT,
              },
            });
          }
        }

        /* A sheet this build does not produce is deleted, not left behind: the
         * kit split containers out of the components sheet, and the old one
         * stayed on the canvas showing a tier that is no longer where it says
         * it is — a picture of a design system that has moved on, which is the
         * one thing a generated page must never be. */
        const wanted = new Set(pages.map((page) => page.name));
        for (const [name, item] of Object.entries(doc.items)) {
          if (item.generated !== KIT_GENERATOR || wanted.has(name)) continue;
          if (doc.flow.nodes[name]) commands.push({ t: 'node.delete', id: name });
          commands.push({ t: 'item.delete', name });
        }

        const written = await ctx.store.runAll(commands);
        if (!written.ok) return fromResult(written, '');

        // Measured only once they are all written: a sheet is as long as what
        // it shows, and what it shows is decided above.
        const sizes = await measure(
          ctx,
          sidecar,
          pages.map((page) => page.name),
        );

        return ctx.store
          .runAll([...sizes].map(([name, size]) => ({ t: 'item.setSize' as const, name, size })))
          .then((r) =>
            fromResult(
              r,
              [
                `Built ${pages.length} kit sheet(s): ${pages.map((p) => p.name).join(', ')}.`,
                sizes.size > 0
                  ? `Each measured itself: ${[...sizes]
                      .map(([name, size]) => `${name} ${size.width}x${size.height}`)
                      .join(', ')} — so an export is the whole sheet.`
                  : 'Could not measure the sheets, so a tall one may export cut off.',
                parts.length === 0
                  ? 'No components yet, so there is no component page — extract_component makes one.'
                  : `${parts.length} item(s) with their variants: a lone <svg> is drawn as an ` +
                    'icon in the dense grid, anything else gets a row on the component page.',
                'Run build_kit again after changing tokens or the registry.',
              ].join('\n'),
            ),
          );
      },
    },
  ];
}

/** How tall each sheet turned out.
 *
 *  Measured rather than guessed: a sheet is as long as what it shows, and
 *  every wrapped caption changes the answer. Empty when the browser cannot be
 *  reached — a kit that renders is worth more than a build that fails over a
 *  number. */
async function measure(
  ctx: ToolContext,
  sidecar: Sidecar,
  names: readonly string[],
): Promise<Map<string, { width: number; height: number }>> {
  const doc = ctx.store.get();
  const out = new Map<string, { width: number; height: number }>();

  try {
    for (const name of names) {
      /* Every viewport, and the tallest answer wins.
       *
       * A sheet used to be the same height whatever the toolbar said, so one
       * measurement at the widest viewport was enough. It is not any more: a
       * part is drawn in a window of its own at the viewport being looked at,
       * and a phone-width window wraps text that a desktop one does not — this
       * design's component sheet is 3713px on a phone and 4025 on a desktop.
       * A single stored size has to be the larger, or the sheet is cut off
       * where it is longest. (Which is the ground's job to make invisible: see
       * `min-height` on .kit.) */
      let tall = 0;
      for (const viewport of doc.viewports) {
        const { html } = composeDocument({
          doc,
          item: name,
          ctx: {
            theme: doc.kit.defaultTheme,
            locale: doc.strings.defaultLocale,
            viewport: viewport.id,
          },
        });
        tall = Math.max(tall, await sidecar.measure(html, sheetWidth(doc)));
      }
      out.set(name, {
        width: sheetWidth(doc),
        // A little air at the bottom, so the last row does not touch the frame.
        height: Math.max(KIT_MIN_HEIGHT, Math.ceil(tall) + 24),
      });
    }
  } catch {
    return new Map();
  }

  return out;
}
