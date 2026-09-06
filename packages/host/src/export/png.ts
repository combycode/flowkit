/* Export screens as PNGs.
 *
 * Naming matches what STRAIW's own exporter produced —
 * `04-ready@mobile-dark.png` — so an export can be dropped straight in beside
 * the originals, and diffed against them.
 *
 * Rendered at 2x by default: this output is for people, and a deliverable
 * wants to stay sharp in a deck. The 1x default belongs to `render_screen`,
 * where the reader is a model that downscales anyway.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { composeDocument } from '@flowkit/core';
import type { Sidecar } from '../render/sidecar';
import { type ExportSelection, screensToExport } from './select';

export interface PngExportOptions extends ExportSelection {
  outDir: string;
  scale?: number;
  /** Called after each file, for progress on a 62-screen project. */
  onFile?: (name: string, index: number, total: number) => void;
}

export interface PngExportResult {
  files: string[];
  bytes: number;
  ms: number;
}

export async function exportPng(
  doc: ProjectDoc,
  sidecar: Sidecar,
  options: PngExportOptions,
): Promise<PngExportResult> {
  const started = Date.now();
  const scale = options.scale ?? 2;
  const jobs = screensToExport(doc, options);

  await mkdir(options.outDir, { recursive: true });

  const files: string[] = [];
  let bytes = 0;

  for (const [index, job] of jobs.entries()) {
    const { html } = composeDocument({ doc, item: job.item, ctx: job.ctx });
    const shot = await sidecar.render({
      html,
      width: job.viewport.width,
      height: job.viewport.height,
      scale,
    });
    const data = Buffer.from(shot.data, 'base64');
    const name = `${job.item}@${job.viewport.id}-${job.ctx.theme}${
      job.ctx.locale === doc.strings.defaultLocale ? '' : `-${job.ctx.locale}`
    }.png`;
    await writeFile(join(options.outDir, name), data);
    files.push(name);
    bytes += data.length;
    options.onFile?.(name, index + 1, jobs.length);
  }

  return { files, bytes, ms: Date.now() - started };
}
