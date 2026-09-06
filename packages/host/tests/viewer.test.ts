/* A shared snapshot is the one artefact that leaves the machine and lands in
 * front of someone who has none of this installed. It gets one chance to
 * work, with no console to check and nobody to ask. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { EMBEDDED_DOC_ID } from '@flowkit/core';
import { exportViewer } from '../src/export/viewer';

let dir: string;
let bundleDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-viewer-'));
  bundleDir = join(dir, 'bundle');
  await Bun.write(join(bundleDir, 'viewer.js'), 'window.__booted = true;');
  await Bun.write(join(bundleDir, 'viewer.css'), '.app{color:red}');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function project(): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'Piece & Parcel <Design>',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '',
      sheets: {},
      themes: { dark: { label: 'Dark', tokens: { '--bg': '#000' } } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {
      one: {
        tier: 'screen',
        html: '<h1>One</h1>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: {
      nodes: {
        a: { screen: 'one', fixture: 'default' },
        b: { screen: 'one', fixture: 'default' },
      },
      edges: { e1: { from: 'a', to: 'b', label: 'ok' } },
      groups: [],
    },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
  };
}

const exportTo = (doc = project()) =>
  exportViewer({ doc, out: join(dir, 'share.html'), bundleDir });

describe('exportViewer', () => {
  test('one file carries the application, the styles and the document', async () => {
    const result = await exportTo();
    const html = await readFile(result.path, 'utf8');

    expect(html).toContain('window.__booted = true;');
    expect(html).toContain('.app{color:red}');
    expect(html).toContain(`id="${EMBEDDED_DOC_ID}"`);
    expect(result.screens).toBe(2);
    expect(result.edges).toBe(1);
  });

  /* The one string joining the exporter and the application. If they diverge,
     the application finds no document, falls through to fetching one from a
     server that is not there, and the recipient sees an error page. */
  test('the document is where the application looks for it', async () => {
    const html = await readFile((await exportTo()).path, 'utf8');

    const opening = `<script id="${EMBEDDED_DOC_ID}" type="application/json">`;
    const start = html.indexOf(opening);
    expect(start).toBeGreaterThan(-1);

    const json = html.slice(start + opening.length, html.indexOf('</script>', start));
    const parsed = JSON.parse(json.replace(/<\\\//g, '</')) as ProjectDoc;
    expect(parsed.flow.edges.e1?.label).toBe('ok');
  });

  test('nothing in the document can close the tag carrying it', async () => {
    const doc = project();
    const one = doc.items.one;
    if (one) one.html = '<p>a </script><script>alert(1)</script> b</p>';

    const html = await readFile((await exportTo(doc)).path, 'utf8');

    // Only a CLOSING tag can end a script block early, so that is the thing
    // to count: two closings, the document's and the application's. An
    // opening tag inside the payload is inert text and stays that way.
    expect(html.split('</script>').length - 1).toBe(2);
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  test('a name with markup in it does not become markup', async () => {
    const html = await readFile((await exportTo()).path, 'utf8');

    expect(html).toContain('<title>Piece &amp; Parcel &lt;Design&gt;</title>');
  });

  /* A build step that has not run should say so, not produce a file that
     opens to a white page. */
  test('a missing bundle is refused with the command that fixes it', async () => {
    await expect(
      exportViewer({ doc: project(), out: join(dir, 'x.html'), bundleDir: join(dir, 'nope') }),
    ).rejects.toThrow(/build:viewer/);
  });

  test('it writes through a folder that does not exist yet', async () => {
    const out = join(dir, 'deep', 'deeper', 'share.html');
    const result = await exportViewer({ doc: project(), out, bundleDir });

    expect(result.path).toBe(out);
    expect((await readFile(out, 'utf8')).length).toBeGreaterThan(0);
  });

  test('a bundle with no stylesheet still exports', async () => {
    const bare = join(dir, 'bare');
    await writeFile(join(await mkdtempAt(bare), 'viewer.js'), 'void 0;');

    const result = await exportViewer({
      doc: project(),
      out: join(dir, 'b.html'),
      bundleDir: bare,
    });
    expect(result.bytes).toBeGreaterThan(0);
  });
});

/** `mkdir -p` for one directory, returning it. */
async function mkdtempAt(path: string): Promise<string> {
  await Bun.write(join(path, '.keep'), '');
  return path;
}
