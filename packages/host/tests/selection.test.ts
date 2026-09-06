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
  peekSelections,
  saveSelection,
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

const selection = (project = 'p', x = 100): Selection => ({
  project,
  at: '2026-09-01T12:00:00.000Z',
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
