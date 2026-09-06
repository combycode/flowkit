/* The specification, written out with its pictures.
 *
 * Core decides what the document SAYS; this renders the screens it refers to
 * and puts the two on disk together. Split that way because the writing is pure
 * — testable without a browser — and only the photographing needs one.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { composeDocument, writeSpec } from '@flowkit/core';
import type { Sidecar } from '../render/sidecar';
import { type ExportSelection, screensToExport } from './select';

export interface SpecExportOptions extends ExportSelection {
  outDir: string;
  /** Which size to photograph at. Defaults to the project's first viewport. */
  viewport?: string;
  theme?: string;
  locale?: string;
  scale?: number;
  /** Skip the pictures — text only, for a spec that travels in a ticket. */
  noImages?: boolean;
  onScreen?: (name: string, index: number, total: number) => void;
}

export interface SpecExportResult {
  path: string;
  images: number;
  bytes: number;
  screens: number;
}

export async function exportSpec(
  doc: ProjectDoc,
  sidecar: Sidecar,
  options: SpecExportOptions,
): Promise<SpecExportResult> {
  const size =
    doc.viewports.find((v) => v.id === options.viewport) ??
    doc.viewports[0] ??
    (() => {
      throw new Error('This project has no viewports, so there is nothing to photograph at.');
    })();

  const theme = options.theme ?? doc.kit.defaultTheme;
  const locale = options.locale ?? doc.strings.defaultLocale;

  const jobs = screensToExport(doc, { ...options, viewports: [size.id], themes: [theme] }).filter(
    (job) => job.viewport.id === size.id,
  );

  await mkdir(resolve(options.outDir), { recursive: true });

  /* Pictures keyed by NODE, not by screen: two nodes can show the same screen
   * — the same sign-in reached from two journeys — and the spec has a section
   * for each. */
  const images: Record<string, string> = {};
  let count = 0;
  let bytes = 0;

  if (!options.noImages) {
    await mkdir(join(resolve(options.outDir), 'images'), { recursive: true });

    for (const [index, job] of jobs.entries()) {
      const { html } = composeDocument({
        doc,
        item: job.item,
        ctx: { theme, locale, viewport: size.id },
      });
      const shot = await sidecar.render({
        html,
        width: job.viewport.width,
        height: job.viewport.height,
        scale: options.scale ?? 2,
      });
      const data = Buffer.from(shot.data, 'base64');
      const file = `${job.item}.png`;
      await writeFile(join(resolve(options.outDir), 'images', file), data);
      bytes += data.length;
      count += 1;

      for (const [id, node] of Object.entries(doc.flow.nodes)) {
        if (node.screen === job.item) images[id] = `images/${file}`;
      }
      options.onScreen?.(job.item, index + 1, jobs.length);
    }
  }

  /* The jobs ARE the spec's scope, and they know more than the selection does:
   * a screen pinned to another size drops out here too, not only a kit sheet
   * that `generated` excluded. Handing the writer the selection instead left
   * five sections describing pages this export had deliberately not
   * photographed. */
  const markdown = writeSpec(doc, {
    ...(options.groups ? { groups: options.groups } : {}),
    screens: [...new Set(jobs.map((job) => job.item))],
    ...(options.noImages ? {} : { images }),
    locale,
  });

  const path = join(resolve(options.outDir), 'SPEC.md');
  await writeFile(path, markdown, 'utf8');
  bytes += Buffer.byteLength(markdown, 'utf8');

  return { path, images: count, bytes, screens: jobs.length };
}
