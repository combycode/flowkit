/* The store is where a correct command layer can still lose data: a bad write
 * path, an interleaved read-modify-write, or an undo that does not persist.
 * These exercise it against a real file. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { Store } from '../src/store';

const doc: ProjectDoc = {
  schema: 1,
  id: 't',
  name: 'Test',
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
    auth: {
      tier: 'screen',
      html: '<h1 data-t="a.t">Hi</h1>',
      props: {},
      fixtures: { default: { values: {} } },
    },
  },
  flow: {
    nodes: { n1: { screen: 'auth', fixture: 'default' } },
    edges: {},
    groups: [],
  },
  strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: { 'a.t': 'Hi' } } } },
  assets: {},
  viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
};

let dir: string;
let path: string;
const originalAppData = process.env.APPDATA;
const originalXdg = process.env.XDG_DATA_HOME;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-store-'));
  path = join(dir, 'project.json');
  // The undo log and the backups live under the application-data folder.
  // A test suite has no business writing into the real one. Both vars, because
  // appDataDir reads APPDATA on Windows and XDG_DATA_HOME on Linux.
  process.env.APPDATA = dir;
  process.env.XDG_DATA_HOME = dir;
  await Bun.write(path, JSON.stringify(doc));
});

afterEach(async () => {
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  await rm(dir, { recursive: true, force: true });
});

const read = async (): Promise<ProjectDoc> => (await Bun.file(path).json()) as ProjectDoc;

describe('Store', () => {
  test('refuses to open a project that is not there', async () => {
    await expect(Store.open({ path: join(dir, 'nope.json') })).rejects.toThrow('No project at');
  });

  test('an accepted command is persisted', async () => {
    const store = await Store.open({ path });
    const r = await store.run({ t: 'project.rename', name: 'Renamed' });
    expect(r.ok).toBe(true);
    expect((await read()).name).toBe('Renamed');
  });

  test('a rejected command writes nothing at all', async () => {
    const store = await Store.open({ path });
    const before = await Bun.file(path).text();
    const r = await store.run({ t: 'node.delete', id: 'nope' });
    expect(r.ok).toBe(false);
    expect(await Bun.file(path).text()).toBe(before);
  });

  test('undo reverts and persists', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'project.rename', name: 'Renamed' });
    const undone = await store.undo();
    expect(undone?.ok).toBe(true);
    expect((await read()).name).toBe('Test');
  });

  test('undo with nothing to undo is not an error', async () => {
    const store = await Store.open({ path });
    expect(await store.undo()).toBeUndefined();
  });

  test('undo unwinds several changes in order', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'project.rename', name: 'One' });
    await store.run({ t: 'project.rename', name: 'Two' });
    await store.undo();
    expect((await read()).name).toBe('One');
    await store.undo();
    expect((await read()).name).toBe('Test');
  });

  test('concurrent writes all land — no lost update', async () => {
    const store = await Store.open({ path });
    // Fired together on purpose: without serialisation these interleave and
    // the last writer wins, silently discarding the others.
    await Promise.all([
      store.run({ t: 'item.create', name: 'a', tier: 'element' }),
      store.run({ t: 'item.create', name: 'b', tier: 'element' }),
      store.run({ t: 'item.create', name: 'c', tier: 'element' }),
    ]);
    expect(Object.keys((await read()).items).sort()).toEqual(['a', 'auth', 'b', 'c']);
  });

  test('leaves no temp file behind', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'project.rename', name: 'X' });
    expect(await Bun.file(`${path}.tmp`).exists()).toBe(false);
  });

  test('runAll is all-or-nothing and undoes as one step', async () => {
    const store = await Store.open({ path });
    const r = await store.runAll([
      { t: 'item.create', name: 'card', tier: 'component' },
      { t: 'item.setHtml', name: 'card', html: '<div data-t="card.x">x</div>' },
    ]);
    expect(r.ok).toBe(true);
    expect((await read()).items.card?.html).toContain('data-t');

    await store.undo();
    expect((await read()).items.card).toBeUndefined();
  });

  test('a failing sequence persists nothing', async () => {
    const store = await Store.open({ path });
    const before = await Bun.file(path).text();
    const r = await store.runAll([
      { t: 'item.create', name: 'ok', tier: 'element' },
      { t: 'item.create', name: 'auth', tier: 'element' }, // duplicate — fails
    ]);
    expect(r.ok).toBe(false);
    expect(await Bun.file(path).text()).toBe(before);
  });

  test('records who made each change', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'project.rename', name: 'X' }, 'mcp');
    expect(store.history().at(-1)?.source).toBe('mcp');
  });
});

/* Two stores on one file.
 *
 * The studio persists a dragged screen and the MCP server writes on a tool
 * call, and neither is going away — so a store has to notice that the file
 * moved underneath it. It is not a theoretical race: without the check, every
 * command from the process that read the file first silently reverts whatever
 * the other one did, because it is computed against a document that never saw
 * the change.
 */
describe('two writers on one file', () => {
  test('a command picks up the other writer’s change instead of reverting it', async () => {
    const mcp = await Store.open({ path });
    const studio = await Store.open({ path });

    await studio.run({ t: 'node.update', id: 'n1', patch: { col: 3, lane: 1 } });
    await mcp.run({ t: 'node.update', id: 'n1', patch: { title: 'Sign in' } });

    const after = await read();
    expect(after.flow.nodes.n1?.title).toBe('Sign in');
    expect(after.flow.nodes.n1?.col).toBe(3);
    expect(after.flow.nodes.n1?.lane).toBe(1);
  });

  test('a stale store reads the file before answering for it', async () => {
    const mcp = await Store.open({ path });
    const studio = await Store.open({ path });

    await studio.run({ t: 'project.rename', name: 'Renamed by the studio' });
    // Forces the refresh: the in-memory copy still says 'Test'.
    await mcp.run({ t: 'node.update', id: 'n1', patch: { order: 2 } });

    expect(mcp.get().name).toBe('Renamed by the studio');
  });

  test('undo takes back only what this store did', async () => {
    const mcp = await Store.open({ path });
    const studio = await Store.open({ path });

    await studio.run({ t: 'node.update', id: 'n1', patch: { col: 5 } });
    await mcp.run({ t: 'node.update', id: 'n1', patch: { title: 'Sign in' } });
    await mcp.undo();

    const after = await read();
    expect(after.flow.nodes.n1?.title).toBeUndefined();
    // The other hand's edit is not the MCP server's to undo.
    expect(after.flow.nodes.n1?.col).toBe(5);
  });
});
