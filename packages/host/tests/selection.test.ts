/* A selection is a gesture, and a gesture is spent once it has been acted on.
 * Everything here is about that: it survives long enough to be picked up, and
 * not a moment longer.
 *
 * They QUEUE. Pointing at three things and then asking one question about them
 * — "why are these inconsistent?" — is ordinary, and the version that kept
 * only the most recent answered about the third and silently dropped two.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Selection } from '../src/selection';
import {
  clearSelection,
  countSelections,
  peekAllSelections,
  peekSelections,
  saveSelection,
  takeAllSelections,
  takeSelections,
} from '../src/selection';

let home: string;
// appDataDir() reads a DIFFERENT env var per platform: APPDATA on Windows,
// XDG_DATA_HOME on Linux. Setting only one leaves the store pointing at the
// real user directory on the other OS — which is why these passed on Windows
// and accumulated on Linux CI. Redirect both.
const original = { APPDATA: process.env.APPDATA, XDG_DATA_HOME: process.env.XDG_DATA_HOME };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'df-sel-'));
  process.env.APPDATA = home;
  process.env.XDG_DATA_HOME = home;
});

afterEach(async () => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(home, { recursive: true, force: true });
});

// A gesture expires ten minutes after it is made, so the fixture must be fresh
// or every read would prune it. Computed once, so two calls compare equal.
const NOW = new Date().toISOString();
const AGES_AGO = new Date(Date.now() - 20 * 60_000).toISOString();

const selection = (project = 'p', x = 100, at = NOW): Selection => ({
  project,
  at,
  region: { x, y: 200, width: 300, height: 400 },
  nodes: ['n1'],
  elements: [
    {
      node: 'n1',
      tag: 'button',
      classes: 'btn btn--primary',
      key: 'auth.sign-in',
      text: 'Sign in',
      box: { x: 10, y: 20, width: 120, height: 44 },
    },
  ],
  view: { theme: 'dark', locale: 'en', viewport: 'mobile', group: 'main' },
});

describe('one selection', () => {
  test('what is written is what comes back', async () => {
    await saveSelection(selection());
    expect(await peekSelections('p')).toEqual([selection()]);
  });

  test('nothing selected is not an error', async () => {
    expect(await peekSelections('never-selected')).toEqual([]);
    expect(await takeSelections('never-selected')).toEqual([]);
    expect(await countSelections('never-selected')).toBe(0);
  });

  /* The one that matters: a gesture answered twice is a gesture answered about
     the wrong question the second time. */
  test('reading consumes it', async () => {
    await saveSelection(selection());

    expect(await takeSelections('p')).toHaveLength(1);
    expect(await takeSelections('p')).toEqual([]);
  });

  test('peeking does not consume it', async () => {
    await saveSelection(selection());

    expect(await peekSelections('p')).toHaveLength(1);
    expect(await peekSelections('p')).toHaveLength(1);
    expect(await takeSelections('p')).toHaveLength(1);
  });

  test('projects do not read each other’s selections', async () => {
    await saveSelection(selection('one'));

    expect(await peekSelections('two')).toEqual([]);
    expect(await peekSelections('one')).toHaveLength(1);
  });

  /* Project ids arrive from the studio's query string, so a traversal has to
     be impossible rather than unlikely. */
  test('a project id cannot escape the selections folder', async () => {
    await saveSelection(selection('../../escaped'));

    // It was written somewhere safe, and it reads back under the same name.
    expect(await peekSelections('../../escaped')).toHaveLength(1);
    expect(await peekSelections('escaped')).toEqual([]);
  });

  test('clearing one that was never there is silent', async () => {
    await clearSelection('nothing-here');
    expect(await peekSelections('nothing-here')).toEqual([]);
  });
});

describe('several, waiting together', () => {
  test('a second does not replace the first', async () => {
    await saveSelection(selection('p', 1));
    await saveSelection(selection('p', 2));
    await saveSelection(selection('p', 3));

    expect((await peekSelections('p')).map((s) => s.region.x)).toEqual([1, 2, 3]);
  });

  test('saving reports how many are now waiting', async () => {
    expect(await saveSelection(selection('p', 1))).toBe(1);
    expect(await saveSelection(selection('p', 2))).toBe(2);
  });

  test('the count is what the header shows', async () => {
    await saveSelection(selection('p', 1));
    await saveSelection(selection('p', 2));

    expect(await countSelections('p')).toBe(2);
  });

  test('reading takes all of them and empties the queue', async () => {
    await saveSelection(selection('p', 1));
    await saveSelection(selection('p', 2));

    expect(await takeSelections('p')).toHaveLength(2);
    expect(await countSelections('p')).toBe(0);
  });

  /* Somebody who has pointed at a twenty-first thing has stopped thinking
     about the first, and a file that only grows is a file that eventually
     matters. */
  test('the queue has a ceiling, and drops the oldest', async () => {
    for (let i = 1; i <= 25; i++) await saveSelection(selection('p', i));

    const waiting = await peekSelections('p');
    expect(waiting).toHaveLength(20);
    expect(waiting[0]?.region.x).toBe(6);
    expect(waiting[19]?.region.x).toBe(25);
  });

  /* A file written before this was a queue holds a single object. Reading it
     as one selection rather than as nothing is the difference between an old
     gesture being answered and an old gesture disappearing. */
  test('a file from before the queue reads as one selection', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    // The store's own directory — NOT a hardcoded "Flowkit", which mismatched
    // the lowercase Linux path (appDataDir uses app.toLowerCase() there).
    const { appDataDir } = await import('../src/paths');
    const dir = join(appDataDir(), 'selections');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'legacy.json'), JSON.stringify(selection('legacy')), 'utf8');

    expect(await peekSelections('legacy')).toHaveLength(1);
  });
});

/* A gesture is a live question, and ten minutes later the person has moved on.
   A stale one answered about a rectangle nobody is looking at any more is worse
   than nothing — and a header that counts it is lying. */
describe('a gesture expires', () => {
  test('an old one is not returned, and the count forgets it', async () => {
    await saveSelection(selection('p', 1, AGES_AGO));

    expect(await peekSelections('p')).toEqual([]);
    expect(await countSelections('p')).toBe(0);
    expect(await takeSelections('p')).toEqual([]);
  });

  test('the fresh survive a purge of the stale in the same queue', async () => {
    await saveSelection(selection('p', 1, AGES_AGO));
    await saveSelection(selection('p', 2)); // fresh

    const live = await peekSelections('p');
    expect(live).toHaveLength(1);
    expect(live[0]?.region.x).toBe(2);
  });

  test('reading a queue prunes the expired file from disk', async () => {
    await saveSelection(selection('p', 1, AGES_AGO));
    // The prune happens on read; nothing survives, so the file is gone.
    await peekSelections('p');
    expect(await countSelections('p')).toBe(0);
  });
});

/* A question with no named project is about whatever the person just pointed
   at, wherever that was — including a gesture in each of two projects, to ask
   the model to compare them. */
describe('across all projects', () => {
  test('peek gathers every waiting gesture, oldest first', async () => {
    await saveSelection(selection('one', 1));
    await saveSelection(selection('two', 2));

    const all = await peekAllSelections();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.project).sort()).toEqual(['one', 'two']);
  });

  test('taking empties every project at once', async () => {
    await saveSelection(selection('one', 1));
    await saveSelection(selection('two', 2));

    expect(await takeAllSelections()).toHaveLength(2);
    expect(await peekAllSelections()).toEqual([]);
    expect(await countSelections('one')).toBe(0);
    expect(await countSelections('two')).toBe(0);
  });

  test('the sweep skips the expired', async () => {
    await saveSelection(selection('one', 1, AGES_AGO));
    await saveSelection(selection('two', 2)); // fresh

    const all = await takeAllSelections();
    expect(all).toHaveLength(1);
    expect(all[0]?.project).toBe('two');
  });

  test('nothing anywhere is not an error', async () => {
    expect(await peekAllSelections()).toEqual([]);
    expect(await takeAllSelections()).toEqual([]);
  });
});
