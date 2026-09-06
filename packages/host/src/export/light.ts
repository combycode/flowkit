/* The design without the markup.
 *
 * Handing somebody the viewer hands them the whole document — every screen's
 * HTML, the CSS, the copy, the fonts. Most of the time that is the point. Some
 * of the time it is not: a client, a partner, a review board, anybody who
 * should see the design without receiving the implementation.
 *
 * So: the same viewer, fed a document whose screens are PICTURES. Nothing new
 * had to be built to render it — a screen backed by an image already renders as
 * one — which is why this is a transformation of the document rather than a
 * second application to keep in step with the first.
 *
 * What survives is the map: where every screen sits, what leads where, on what
 * condition, in which flow. What does not survive is anything a reader could
 * rebuild the product from.
 */

import type { ProjectDoc, RenderContext } from '@flowkit/core';
import { composeDocument } from '@flowkit/core';
import type { Sidecar } from '../render/sidecar';
import { type ExportSelection, screensToExport } from './select';

export interface LightOptions extends ExportSelection {
  /** Which size to photograph at. Defaults to the project's first viewport.
   *
   *  One, not several: a screen carries one picture, so a document offering a
   *  size switch that changed nothing would be a lie. Export twice for two. */
  viewport?: string;
  theme?: string;
  locale?: string;
  /** 2 by default — these are for people to look at. */
  scale?: number;
  onScreen?: (name: string, index: number, total: number) => void;
}

export interface LightResult {
  doc: ProjectDoc;
  screens: number;
  bytes: number;
}

export async function lightDocument(
  doc: ProjectDoc,
  sidecar: Sidecar,
  options: LightOptions = {},
): Promise<LightResult> {
  const scale = options.scale ?? 2;
  const size =
    doc.viewports.find((v) => v.id === options.viewport) ??
    doc.viewports[0] ??
    (() => {
      throw new Error('This project has no viewports, so there is nothing to photograph at.');
    })();

  const theme = options.theme ?? doc.kit.defaultTheme;
  const locale = options.locale ?? doc.strings.defaultLocale;

  // One job per screen, at one viewport — `screensToExport` would give a job
  // per size, and every one of them would be the same picture under another
  // name.
  const jobs = screensToExport(doc, { ...options, viewports: [size.id], themes: [theme] }).filter(
    (job) => job.viewport.id === size.id,
  );

  const items: ProjectDoc['items'] = {};
  const assets: ProjectDoc['assets'] = {};
  let bytes = 0;

  for (const [index, job] of jobs.entries()) {
    const source = doc.items[job.item];
    if (!source) continue;

    const ctx: RenderContext = { theme, locale, viewport: job.viewport.id };
    const { html } = composeDocument({ doc, item: job.item, ctx });
    const shot = await sidecar.render({
      html,
      width: job.viewport.width,
      height: job.viewport.height,
      scale,
    });

    const assetId = `shot-${job.item}`;
    assets[assetId] = {
      kind: 'image',
      mime: 'image/png',
      bytes: shot.data,
      label: `${job.item}@${job.viewport.id}`,
    };
    bytes += Math.round((shot.data.length * 3) / 4);

    /* Everything a reader could rebuild from is left behind: no html, no css,
     * no stylesheets, no root attributes. What is kept is what the canvas
     * shows — the description under the frame, and the size a screen measured
     * itself at, or a kit sheet would be drawn as a phone. */
    items[job.item] = {
      tier: 'screen',
      html: '',
      image: assetId,
      props: {},
      fixtures: { default: { values: {} } },
      ...(source.description !== undefined ? { description: source.description } : {}),
      ...(source.size !== undefined ? { size: source.size } : {}),
    };

    options.onScreen?.(job.item, index + 1, jobs.length);
  }

  /* Nodes for the screens that made it, and edges between those.
   *
   * Node meta is dropped on purpose: it holds roles, endpoints and rules — the
   * kind of thing this export exists to keep back — and the canvas does not
   * draw it anyway. */
  const nodes: ProjectDoc['flow']['nodes'] = {};
  for (const [id, node] of Object.entries(doc.flow.nodes)) {
    if (!items[node.screen]) continue;
    const { meta: _meta, layoutProps: _props, slots: _slots, ...rest } = node;
    nodes[id] = rest;
  }

  const edges: ProjectDoc['flow']['edges'] = {};
  for (const [id, edge] of Object.entries(doc.flow.edges)) {
    if (nodes[edge.from] && nodes[edge.to]) edges[id] = edge;
  }

  return {
    screens: Object.keys(items).length,
    bytes,
    doc: {
      ...doc,
      kit: {
        preset: 'none',
        base: '',
        sheets: {},
        // A theme has to exist for the switch to have something to name, and
        // its tokens style nothing here: a picture is a picture.
        themes: { [theme]: { label: doc.kit.themes[theme]?.label ?? theme, tokens: {} } },
        defaultTheme: theme,
        fonts: [],
      },
      items,
      flow: { ...doc.flow, nodes, edges },
      strings: {
        defaultLocale: locale,
        locales: { [locale]: { label: doc.strings.locales[locale]?.label ?? locale, entries: {} } },
      },
      assets,
      viewports: [size],
    },
  };
}
