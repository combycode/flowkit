/* The local server is the only door into the document from a browser, and it
 * runs on a machine where any web page can ask a browser to talk to
 * localhost. These go over real HTTP for that reason: a route that is only
 * ever called from its own module is not the thing that gets attacked. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { peekSelections } from '../src/selection';
import { type Studio, serveStudio } from '../src/server/studio';
import { Workspace } from '../src/workspace';

const doc: ProjectDoc = {
  schema: 1,
  id: 'demo',
  name: 'Demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  kit: {
    preset: 'none',
    base: '',
    sheets: {},
    themes: { dark: { label: 'Dark', tokens: { '--bg': '#000' } } },
    defaultTheme: 'dark',
    fonts: [],
  },
  items: {
    home: {
      tier: 'screen',
      html: '<h1>Home</h1>',
      props: {},
      fixtures: { default: { values: {} } },
    },
  },
  flow: {
    nodes: {
      n1: { screen: 'home', fixture: 'default' },
      n2: { screen: 'home', fixture: 'default' },
    },
    edges: {},
    groups: [],
  },
  strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
  assets: {},
  viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
};

let home: string;
let bundleDir: string;
let studio: Studio;
let base: string;
const originalHome = process.env.FLOWKIT_HOME;
const originalAppData = process.env.APPDATA;
const originalXdg = process.env.XDG_DATA_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'df-server-'));
  process.env.FLOWKIT_HOME = join(home, 'projects');
  // Selections live under the app-data folder; keep them out of the real one.
  // Both vars, because appDataDir reads APPDATA on Windows and XDG_DATA_HOME on Linux.
  process.env.APPDATA = home;
  process.env.XDG_DATA_HOME = home;

  bundleDir = join(home, 'bundle');
  await Bun.write(join(bundleDir, 'viewer.js'), 'window.__studio = 1;');
  await Bun.write(join(bundleDir, 'viewer.css'), '.app{color:red}');
  await Bun.write(join(home, 'projects', 'demo.json'), JSON.stringify(doc));

  const workspace = await Workspace.at();
  // A high port, so a developer's own studio on 5190 is never disturbed.
  studio = await serveStudio({ workspace, port: 5391, bundleDir });
  base = studio.url;
});

afterEach(async () => {
  studio.stop();
  if (originalHome === undefined) delete process.env.FLOWKIT_HOME;
  else process.env.FLOWKIT_HOME = originalHome;
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  await rm(home, { recursive: true, force: true });
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('serving the studio', () => {
  test('the shell asks for the bundle the build produces', async () => {
    const html = await (await fetch(`${base}/`)).text();

    expect(html).toContain('<div id="root">');
    expect(html).toContain('/viewer.js');
    expect(html).toContain('/viewer.css');
  });

  test('the bundle is served, and never cached', async () => {
    const js = await fetch(`${base}/viewer.js`);

    expect(await js.text()).toBe('window.__studio = 1;');
    expect(js.headers.get('cache-control')).toBe('no-store');
  });

  /* A static server rooted at a build directory is one path-traversal bug
     away from serving the project file, or a private key. Only two exact
     names ever reach the filesystem, so there is no path to traverse — this
     plants a file next to the bundle and proves it cannot be reached. */
  test('nothing but the two known files is served', async () => {
    await Bun.write(join(home, 'secret.txt'), 'a private key');
    await Bun.write(join(bundleDir, 'secret.txt'), 'also private');

    for (const path of [
      '/secret.txt',
      '/../secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%2fsecret.txt',
      '/etc/passwd',
      '/projects/../secret.txt',
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(await res.text()).not.toContain('private');
    }
  });

  test('a missing bundle says how to build it rather than 404ing', async () => {
    const workspace = await Workspace.at();
    const bare = await serveStudio({ workspace, port: 5395, bundleDir: join(home, 'nope') });
    const res = await fetch(`${bare.url}/viewer.js`);

    expect(res.status).toBe(503);
    expect(await res.text()).toContain('build:viewer');
    bare.stop();
  });
});

describe('reading the project', () => {
  test('the document comes back with a modification time to poll', async () => {
    const res = await fetch(`${base}/projects/demo.json`);
    const body = (await res.json()) as ProjectDoc;

    expect(body.name).toBe('Demo');
    expect(res.headers.get('last-modified')).toBeTruthy();
  });

  test('a HEAD costs nothing and still carries the timestamp', async () => {
    const res = await fetch(`${base}/projects/demo.json`, { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.headers.get('last-modified')).toBeTruthy();
    expect(await res.text()).toBe('');
  });

  test('an unknown project says which ones exist', async () => {
    const res = await fetch(`${base}/projects/ghost.json`);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('demo');
  });
});

describe('writing through the command layer', () => {
  test('a command reaches the document on disk', async () => {
    const res = await post('/command/demo', { t: 'node.update', id: 'n1', patch: { col: 3 } });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    const saved = JSON.parse(
      await readFile(join(home, 'projects', 'demo.json'), 'utf8'),
    ) as ProjectDoc;
    expect(saved.flow.nodes.n1?.col).toBe(3);
  });

  test('a batch is all-or-nothing', async () => {
    const res = await post('/command/demo', [
      { t: 'node.update', id: 'n1', patch: { col: 9 } },
      { t: 'node.update', id: 'ghost', patch: { col: 9 } },
    ]);

    expect(res.status).toBe(400);
    const saved = JSON.parse(
      await readFile(join(home, 'projects', 'demo.json'), 'utf8'),
    ) as ProjectDoc;
    expect(saved.flow.nodes.n1?.col).toBeUndefined();
  });

  test('a rejection carries the diagnostics that say why', async () => {
    const res = await post('/command/demo', { t: 'node.update', id: 'ghost', patch: { col: 1 } });
    const body = (await res.json()) as { ok: boolean; diagnostics: { code: string }[] };

    expect(body.ok).toBe(false);
    expect(body.diagnostics[0]?.code).toBe('unknown-node');
  });

  test('nonsense is refused without taking the server down', async () => {
    const res = await fetch(`${base}/command/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });

    expect(res.status).toBe(400);
    expect((await fetch(`${base}/health`)).ok).toBe(true);
  });

  test('GET cannot write', async () => {
    expect((await fetch(`${base}/command/demo`)).status).toBe(405);
  });
});

describe('recording a selection', () => {
  test('a selection is stored against the project', async () => {
    const res = await post('/selection/demo', {
      region: { x: 1, y: 2, width: 3, height: 4 },
      nodes: ['n1'],
      elements: [],
      view: { theme: 'dark', locale: 'en', viewport: 'mobile', group: null },
    });

    expect(res.status).toBe(200);
    expect((await peekSelections('demo'))[0]?.region.width).toBe(3);
  });

  test('a selection without a region is refused', async () => {
    expect((await post('/selection/demo', { nodes: [] })).status).toBe(400);
  });

  /* What the header badge reads. Until it existed, a gesture that had been
     recorded and one that had silently failed looked exactly alike. */
  test('the count says how many are waiting, and rises with each one', async () => {
    const body = {
      region: { x: 1, y: 2, width: 3, height: 4 },
      nodes: ['n1'],
      elements: [],
      view: { theme: 'dark', locale: 'en', viewport: 'mobile', group: null },
    };

    const empty = (await (await fetch(`${base}/selection/demo`)).json()) as { count: number };
    expect(empty.count).toBe(0);

    expect(((await (await post('/selection/demo', body)).json()) as { count: number }).count).toBe(
      1,
    );
    expect(((await (await post('/selection/demo', body)).json()) as { count: number }).count).toBe(
      2,
    );

    const after = (await (await fetch(`${base}/selection/demo`)).json()) as { count: number };
    expect(after.count).toBe(2);
  });

  /* The canvas polls this before anything has been pointed at, and for a
     project that may not be open. Neither is an error worth a red line. */
  test('asking about a project that is not there answers zero', async () => {
    const res = await fetch(`${base}/selection/ghost`);
    const body = (await res.json()) as { ok: boolean; count: number };

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
  });
});

/* The reason this server binds to loopback and checks headers: it writes to
   files, and any page in the user's browser can be made to POST here. */
describe('refusing the outside world', () => {
  test('a write from another site is refused', async () => {
    const res = await post(
      '/command/demo',
      { t: 'node.update', id: 'n1', patch: { col: 5 } },
      {
        Origin: 'https://evil.example',
      },
    );

    expect(res.status).toBe(403);
    const saved = JSON.parse(
      await readFile(join(home, 'projects', 'demo.json'), 'utf8'),
    ) as ProjectDoc;
    expect(saved.flow.nodes.n1?.col).toBeUndefined();
  });

  test('a write from the studio itself is allowed', async () => {
    const res = await post(
      '/command/demo',
      { t: 'node.update', id: 'n1', patch: { col: 5 } },
      {
        Origin: base,
      },
    );

    expect(res.status).toBe(200);
  });

  /* DNS rebinding: an attacker's domain resolving to 127.0.0.1 arrives with
     THEIR name in the Host header, not ours. */
  test('a request addressed to somebody else’s hostname is refused', async () => {
    const res = await fetch(`${base}/projects/demo.json`, {
      headers: { Host: 'attacker.example' },
    });

    expect(res.status).toBe(403);
  });
});

describe('one studio per design', () => {
  test('a second start on the same workspace adopts the first', async () => {
    const workspace = await Workspace.at();
    const second = await serveStudio({ workspace, port: 5391, bundleDir });

    expect(second.adopted).toBe(true);
    expect(second.port).toBe(studio.port);
    second.stop();

    // Adopting must not have stopped the one that was already there.
    expect((await fetch(`${base}/health`)).ok).toBe(true);
  });

  /* One canvas per DESIGN, not per machine. Two agents working in two
     repositories both start a studio, and adopting one another's would show
     each of them the other's screens — with nothing to notice, because a
     canvas full of the wrong screens looks like a canvas full of screens. */
  test('a studio for another workspace is not adopted, it gets its own port', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'df-other-'));
    const other = await serveStudio({
      workspace: await Workspace.at(elsewhere),
      port: 5391,
      bundleDir,
    });

    expect(other.adopted).toBe(false);
    expect(other.port).not.toBe(studio.port);

    const mine = (await (await fetch(`${base}/health`)).json()) as { workspace: string };
    const theirs = (await (await fetch(`${other.url}/health`)).json()) as { workspace: string };
    expect(theirs.workspace).not.toBe(mine.workspace);

    other.stop();
    await rm(elsewhere, { recursive: true, force: true });
  });

  test('health says which server this is and what it is serving', async () => {
    const body = (await (await fetch(`${base}/health`)).json()) as {
      app: string;
      workspace: string;
    };

    expect(body.app).toBe('flowkit-studio');
    expect(body.workspace).toBe(process.env.FLOWKIT_HOME ?? '');
  });
});
