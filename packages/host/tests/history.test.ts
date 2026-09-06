/* Undo that survives closing the window, and copies for when it does not.
 *
 * The failure these exist to prevent is quiet: a log applied to a document it
 * was not computed from does not error, it writes values that never existed. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { backup, backups, findBackup } from '../src/backups';
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
    auth: { tier: 'screen', html: '<h1>Hi</h1>', props: {}, fixtures: { default: { values: {} } } },
  },
  flow: { nodes: { n1: { screen: 'auth', fixture: 'default' } }, edges: {}, groups: [] },
  strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
  assets: {},
  viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
};

let dir: string;
let path: string;
// Redirect BOTH data-dir env vars: APPDATA (Windows) and XDG_DATA_HOME (Linux).
// Setting only APPDATA left backups writing to the real home on Linux CI, where
// they accumulated across tests. See selection.test.ts for the same fix.
const original = { APPDATA: process.env.APPDATA, XDG_DATA_HOME: process.env.XDG_DATA_HOME };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-hist-'));
  path = join(dir, 'project.json');
  process.env.APPDATA = dir;
  process.env.XDG_DATA_HOME = dir;
  await Bun.write(path, JSON.stringify(doc));
});

afterEach(async () => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(dir, { recursive: true, force: true });
});

const read = async (): Promise<ProjectDoc> => (await Bun.file(path).json()) as ProjectDoc;

describe('undo across a restart', () => {
  /* The whole point: close the window, come back, take it back. */
  test('a change made in one session is undone in the next', async () => {
    const first = await Store.open({ path });
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'Renamed' } });
    expect((await read()).flow.nodes.n1?.title).toBe('Renamed');

    // A different Store, as after a restart.
    const second = await Store.open({ path });
    expect(second.history()).toHaveLength(1);

    await second.undo();
    expect((await read()).flow.nodes.n1?.title).toBeUndefined();
  });

  test('several steps come back in order', async () => {
    const first = await Store.open({ path });
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'One' } });
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'Two' } });

    const second = await Store.open({ path });
    await second.undo();
    expect((await read()).flow.nodes.n1?.title).toBe('One');
    await second.undo();
    expect((await read()).flow.nodes.n1?.title).toBeUndefined();
  });

  /* The bug this exists for: an undo writes a new updatedAt, so without
     re-sealing, the entries left describe the state before it. In ONE process
     that goes unnoticed — the log is already in memory. Across two, the next
     open sees a mismatch and throws the whole history away, which is exactly
     the case persisting it exists for. */
  test('undo twice, with a restart in between', async () => {
    const first = await Store.open({ path });
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'One' } });
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'Two' } });

    const second = await Store.open({ path });
    await second.undo();
    expect((await read()).flow.nodes.n1?.title).toBe('One');

    // A different process again — this is where the log used to vanish.
    const third = await Store.open({ path });
    expect(third.history()).toHaveLength(1);
    await third.undo();
    expect((await read()).flow.nodes.n1?.title).toBeUndefined();
  });

  test('a batch undoes as the one thing it was', async () => {
    const store = await Store.open({ path });
    await store.runAll([
      { t: 'node.update', id: 'n1', patch: { title: 'A' } },
      { t: 'node.update', id: 'n1', patch: { description: 'B' } },
    ]);

    const next = await Store.open({ path });
    expect(next.history()).toHaveLength(1);
    await next.undo();

    const after = await read();
    expect(after.flow.nodes.n1?.title).toBeUndefined();
    expect(after.flow.nodes.n1?.description).toBeUndefined();
  });

  /* THE DANGEROUS CASE. An inverse restores the value a node HAD. Applied to
     a document that has been replaced underneath it, that value is fiction —
     and nothing about the operation looks like an error. */
  test('a log that no longer matches the document is discarded, not applied', async () => {
    const first = await Store.open({ path });
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'From this session' } });

    // Something else replaces the file — a restore, an editor, a git checkout.
    await Bun.write(path, JSON.stringify({ ...doc, updatedAt: '2027-01-01T00:00:00.000Z' }));

    const second = await Store.open({ path });
    expect(second.history()).toHaveLength(0);
    expect(await second.undo()).toBeUndefined();
  });

  /* The subtlest failure in the whole feature, and the one most likely to be
     reintroduced by someone tidying the serialisation: an inverse clears a key
     the command ADDED by naming it with `undefined`, and JSON.stringify drops
     exactly those keys. Written naively, the log survives a restart and the
     undo quietly does nothing. */
  test('an undo that must REMOVE a field still removes it after a restart', async () => {
    const first = await Store.open({ path });
    // n1 has no title; this adds one, so undoing it has to take it away
    // again — not merely fail to mention it.
    await first.run({ t: 'node.update', id: 'n1', patch: { title: 'Added' } });

    const second = await Store.open({ path });
    const entry = second.history()[0];
    const inverse = entry?.inverse[0];
    expect(inverse).toBeDefined();
    // The key is PRESENT and undefined. Absent would mean "leave it alone".
    const patch = (inverse as { patch: Record<string, unknown> }).patch;
    expect('title' in patch).toBe(true);
    expect(patch.title).toBeUndefined();

    await second.undo();
    expect((await read()).flow.nodes.n1?.title).toBeUndefined();
  });

  test('nothing to undo is not an error', async () => {
    const store = await Store.open({ path });
    expect(await store.undo()).toBeUndefined();
  });

  test('an ephemeral store leaves nothing behind', async () => {
    const store = await Store.open({ path, ephemeral: true });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'X' } });

    // The store's own history dir — not a hardcoded "Flowkit", which on Linux
    // read a non-existent capital path and so passed without checking anything.
    const { appDataDir } = await import('../src/paths');
    expect(await readdir(join(appDataDir(), 'history')).catch(() => [])).toHaveLength(0);
  });
});

describe('backups', () => {
  test('the version before the first change of a session is kept', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'Changed' } });

    const kept = await backups(path);
    expect(kept).toHaveLength(1);

    const saved = JSON.parse(await readFile(kept[0]!.path, 'utf8')) as ProjectDoc;
    expect(saved.flow.nodes.n1?.title).toBeUndefined();
  });

  /* A copy per command would write a megabyte every time a screen is dragged. */
  test('later changes in the same session do not each make a copy', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'A' } });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'B' } });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'C' } });

    expect(await backups(path)).toHaveLength(1);
  });

  test('a forced copy is taken however recent the last one was', async () => {
    await backup(path, { force: true });
    await backup(path, { force: true });

    expect(await backups(path)).toHaveLength(2);
  });

  test('the throttle holds when nothing forces it', async () => {
    await backup(path, { force: true });
    expect(await backup(path, { everyMs: 60_000 })).toBeUndefined();
  });

  test('only the newest few are kept', async () => {
    for (let i = 0; i < 6; i++) await backup(path, { force: true, keep: 3 });
    expect((await backups(path)).length).toBeLessThanOrEqual(3);
  });

  test('a copy is found by the time it was taken', async () => {
    const made = await backup(path, { force: true });
    expect(made).toBeDefined();

    const found = await findBackup(path, made?.at);
    expect(found?.path).toBe(made?.path as string);
  });

  test('backing up a project that is not there is silent', async () => {
    expect(await backup(join(dir, 'ghost.json'), { force: true })).toBeUndefined();
  });
});

describe('restoring', () => {
  test('a restored document is what comes back, and a copy is kept first', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'Wrong' } });
    const before = await backups(path);

    await store.restore(doc);

    expect((await read()).flow.nodes.n1?.title).toBeUndefined();
    // The state being replaced was itself worth keeping.
    expect((await backups(path)).length).toBe(before.length + 1);
  });

  /* Every inverse in the log was computed against a document that is no
     longer here, so keeping them would undo values from a different history. */
  test('restoring drops the undo log rather than leaving it lying', async () => {
    const store = await Store.open({ path });
    await store.run({ t: 'node.update', id: 'n1', patch: { title: 'Wrong' } });
    expect(store.history()).toHaveLength(1);

    await store.restore(doc);
    expect(store.history()).toHaveLength(0);
    expect(await store.undo()).toBeUndefined();
  });
});
