/* Export screens as HTML plus a contact sheet.
 *
 * The screens are the same documents the canvas renders and the sidecar
 * photographs — one `composeDocument`, so an exported page cannot differ from
 * what was approved.
 *
 * Styles are written ONCE per theme and linked, not inlined per screen. The
 * folder is the unit of self-containment here: inlining made a 62-screen
 * export 73 MB of which almost all was the same stylesheet and the same fonts
 * repeated 62 times. Linking makes it about 1 MB and changes nothing about
 * what renders.
 *
 * `inline: true` restores per-file self-containment, for when a single page
 * has to travel on its own.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { composeDocument, composeStylesheet } from '@flowkit/core';
import { renderIndex } from './index-page';
import { type ExportJob, type ExportSelection, screensToExport } from './select';

export interface HtmlExportOptions extends ExportSelection {
  outDir: string;
  /** Subfolder for the screens themselves. */
  screensDir?: string;
  /** Make every page carry its own styles. Bigger, but each file stands alone. */
  inline?: boolean;
  /** Progress, for a project large enough that the caller would otherwise
   *  time out waiting. */
  onFile?: (name: string, index: number, total: number) => void;
}

export interface HtmlExportResult {
  indexPath: string;
  files: string[];
  stylesheets: string[];
  bytes: number;
}

/** A screen's file name. Encodes every axis that varies, so two renders of the
 *  same screen in different themes cannot collide. */
export function fileNameOf(doc: ProjectDoc, job: ExportJob): string {
  const theme = job.ctx.theme === doc.kit.defaultTheme ? '' : `-${job.ctx.theme}`;
  const locale = job.ctx.locale === doc.strings.defaultLocale ? '' : `-${job.ctx.locale}`;
  return `${job.item}@${job.viewport.id}${theme}${locale}.html`;
}

export async function exportHtml(
  doc: ProjectDoc,
  options: HtmlExportOptions,
): Promise<HtmlExportResult> {
  const screensDir = options.screensDir ?? 'screens';
  const jobs = screensToExport(doc, options);

  await mkdir(join(options.outDir, screensDir), { recursive: true });

  const stylesheets: string[] = [];
  let bytes = 0;

  if (!options.inline) {
    await mkdir(join(options.outDir, 'assets'), { recursive: true });
    // One sheet per theme actually used. Every item's CSS goes in, so a screen
    // can link one file rather than a set that varies per screen.
    for (const theme of new Set(jobs.map((j) => j.ctx.theme))) {
      const css = composeStylesheet(doc, theme);
      const name = `assets/kit-${theme}.css`;
      await writeFile(join(options.outDir, name), css, 'utf8');
      stylesheets.push(name);
      bytes += Buffer.byteLength(css);
    }
  }

  const files: string[] = [];
  for (const [index, job] of jobs.entries()) {
    const { html } = composeDocument({
      doc,
      item: job.item,
      ctx: job.ctx,
      // Relative to the screen, which lives one folder down.
      styles: options.inline ? 'inline' : { href: `../assets/kit-${job.ctx.theme}.css` },
    });
    const name = fileNameOf(doc, job);
    await writeFile(join(options.outDir, screensDir, name), html, 'utf8');
    files.push(`/winget`);
    bytes += Buffer.byteLength(html);
    options.onFile?.(name, index + 1, jobs.length);
  }

  const index = renderIndex({
    doc,
    jobs,
    fileOf: (job) => `${screensDir}/${fileNameOf(doc, job)}`,
  });
  const indexPath = join(options.outDir, 'index.html');
  await writeFile(indexPath, index, 'utf8');
  bytes += Buffer.byteLength(index);

  return { indexPath, files, stylesheets, bytes };
}
