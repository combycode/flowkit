/* One file that is the whole design.
 *
 * The folder export gives you pages; it does not give you the FLOW. Someone
 * opening it sees sixty-two screens and no account of how anyone gets from
 * one to the next, which is most of what a design review is about. This is
 * the canvas itself — screens where they sit, connections, labels, the flow
 * filter, and the theme, language and size switches — in a single file that
 * opens by double-clicking it.
 *
 * No server, no account, no network. The document already inlines its fonts
 * and composes its own CSS, so the recipient's browser has everything it
 * needs; the only thing added here is the application, and it is the SAME
 * application, with nothing to write to and therefore nothing writable.
 *
 * A snapshot, deliberately. What you sent on Tuesday stays what you sent.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { EMBEDDED_DOC_ID } from '@flowkit/core';
import { escapeCss, escapeJs, escapeJson } from '../embed';
import { exists } from '../fsx';
import { findViewerBundle } from '../viewer-bundle';

export interface ViewerExportOptions {
  doc: ProjectDoc;
  /** Where to write. Defaults to `<name>.html` beside the project file. */
  out: string;
  /** The built viewer bundle. Defaults to the studio's `dist-viewer`. */
  bundleDir?: string;
}

export interface ViewerExportResult {
  path: string;
  bytes: number;
  screens: number;
  edges: number;
}

export async function exportViewer(options: ViewerExportOptions): Promise<ViewerExportResult> {
  const bundle = await loadBundle(options.bundleDir);
  const html = page(options.doc, bundle);

  await mkdir(dirname(resolve(options.out)), { recursive: true });
  await writeFile(options.out, html, 'utf8');

  return {
    path: resolve(options.out),
    bytes: Buffer.byteLength(html, 'utf8'),
    screens: Object.keys(options.doc.flow.nodes).length,
    edges: Object.keys(options.doc.flow.edges).length,
  };
}

interface Bundle {
  js: string;
  css: string;
}

/** Built by `bun run build:viewer`. Not generated here: a build is a build
 *  step, and an export that silently invoked a bundler would be a surprising
 *  thing for a tool call to do. */
async function loadBundle(dir?: string): Promise<Bundle> {
  const root = dir ?? findViewerBundle(import.meta.dirname);
  if (!root || !(await exists(join(root, 'viewer.js')))) {
    throw new Error(
      'No viewer bundle found. In the repo, build it with `bun run build:viewer`; ' +
        'a published package ships it. Or set FLOWKIT_VIEWER to its folder.',
    );
  }

  return {
    js: await readFile(join(root, 'viewer.js'), 'utf8'),
    css: (await exists(join(root, 'viewer.css')))
      ? await readFile(join(root, 'viewer.css'), 'utf8')
      : '',
  };
}

function page(doc: ProjectDoc, bundle: Bundle): string {
  return `<!doctype html>
<html lang="${escapeAttr(doc.strings.defaultLocale)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(doc.name)}</title>
<style>${escapeCss(bundle.css)}</style>
</head>
<body>
<div id="root"></div>
<script id="${EMBEDDED_DOC_ID}" type="application/json">${escapeJson(JSON.stringify(doc))}</script>
<script>${escapeJs(bundle.js)}</script>
</body>
</html>
`;
}

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');
