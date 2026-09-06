/* Moving a project, and the duplicate it used to leave behind.
 *
 * The bug that prompted this: a design was relocated on disk, opened at its new
 * path, and the workspace minted a second id (`app-2`) while the first stayed
 * in the list pointing at a file that was gone. A move is a first-class thing;
 * it should keep the id and leave no ghost.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { exists } from '../src/fsx';
import { Workspace } from '../src/workspace';

let home: string;
const originalHome = process.env.FLOWKIT_HOME;
const originalAppData = process.env.APPDATA;
const originalXdg = process.env.XDG_DATA_HOME;

const doc = (id: string): ProjectDoc => ({
  schema: 1,
  id,
  name: 'App',
  createdAt: '',
  updatedAt: '',
  kit: {
    preset: 'none',
    base: '',
    sheets: {},
    themes: { dark: { label: 'Dark', tokens: {} } },
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
  flow: { nodes: { home: { screen: 'home', fixture: 'default' } }, edges: {}, groups: [] },
  strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
  assets: {},
  viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'df-ws-'));
  process.env.FLOWKIT_HOME = join(home, 'workspace');
  // Both, because appDataDir reads APPDATA on Windows and XDG_DATA_HOME on Linux.
  process.env.APPDATA = home;
  process.env.XDG_DATA_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.FLOWKIT_HOME;
  else process.env.FLOWKIT_HOME = originalHome;
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  await rm(home, { recursive: true, force: true });
});

async function projectAt(dir: string, id: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.json`);
  await writeFile(path, JSON.stringify(doc(id)), 'utf8');
  return path;
}

describe('moving a project', () => {
  test('keeps the id, moves the file, leaves no ghost', async () => {
    const from = await projectAt(join(home, 'a'), 'app');
    const ws = await Workspace.at();
    const opened = await ws.openPath(from);
    expect(opened.id).toBe('app');

    const moved = await ws.move('app', join(home, 'b'));

    expect(moved.id).toBe('app');
    expect(moved.path).toBe(join(home, 'b', 'app.json'));
    expect(await exists(join(home, 'b', 'app.json'))).toBe(true);
    expect(await exists(from)).toBe(false);

    const ids = (await ws.list()).map((p) => p.id);
    expect(ids).toEqual(['app']); // exactly one, no app-2
  });

  test('accepts a full .json destination, not only a folder', async () => {
    const from = await projectAt(join(home, 'a'), 'app');
    const ws = await Workspace.at();
    await ws.openPath(from);

    const moved = await ws.move('app', join(home, 'c', 'renamed-place.json'));
    expect(moved.path).toBe(join(home, 'c', 'renamed-place.json'));
    expect(moved.id).toBe('app'); // the id is the id; the filename is just where it sits
  });

  test('refuses to clobber a file already there', async () => {
    const from = await projectAt(join(home, 'a'), 'app');
    await projectAt(join(home, 'b'), 'app');
    const ws = await Workspace.at();
    await ws.openPath(from);

    await expect(ws.move('app', join(home, 'b'))).rejects.toThrow(/already exists/);
    expect(await exists(from)).toBe(true); // nothing lost on refusal
  });

  test('the moved project is readable at its new home', async () => {
    const from = await projectAt(join(home, 'a'), 'app');
    const ws = await Workspace.at();
    await ws.openPath(from);
    await ws.move('app', join(home, 'b'));

    const { store, path } = await ws.require('app');
    expect(path).toBe(join(home, 'b', 'app.json'));
    expect(Object.keys(store.get().items)).toContain('home');
  });
});

describe('opening a file that was moved by hand', () => {
  /* The exact reported sequence: relocate the file yourself, then open it at
     the new path. It must reclaim the id, not mint a duplicate. */
  test('reclaims the id instead of minting a duplicate', async () => {
    const from = await projectAt(join(home, 'a'), 'app');
    const ws = await Workspace.at();
    await ws.openPath(from); // remembered at the old path

    // move the file underneath the workspace, by hand
    const to = join(home, 'b', 'app.json');
    await mkdir(join(home, 'b'), { recursive: true });
    await writeFile(to, JSON.stringify(doc('app')), 'utf8');
    await rm(from, { force: true });

    const reopened = await ws.openPath(to);
    expect(reopened.id).toBe('app'); // not app-2

    const ids = (await ws.list()).map((p) => p.id);
    expect(ids).toEqual(['app']);
  });

  /* But two DIFFERENT live files that share an id must still coexist — the
     reclaim only fires when the old path is truly gone. */
  test('two live files sharing an id still get distinct ids', async () => {
    const a = await projectAt(join(home, 'a'), 'app');
    const b = await projectAt(join(home, 'b'), 'app');
    const ws = await Workspace.at();

    expect((await ws.openPath(a)).id).toBe('app');
    expect((await ws.openPath(b)).id).toBe('app-2');
  });
});

describe('forgetting a project', () => {
  test('drops it from the list without deleting the file', async () => {
    const from = await projectAt(join(home, 'a'), 'app');
    const ws = await Workspace.at();
    await ws.openPath(from);

    await ws.forgetProject('app');

    expect((await ws.list()).map((p) => p.id)).not.toContain('app');
    expect(await exists(from)).toBe(true);
  });
});
