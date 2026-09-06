/* How the sidecar learns which port its browser is on.
 *
 * The version this replaced picked a free port and passed it in. Four export
 * processes started at once, three of them checked the same port a moment
 * apart, all three found it free and all three passed it to Chromium. One
 * browser got it; the other two attached to that one — a stranger's browser
 * with a stranger's page — and their screenshots came back showing somebody
 * else's screen. Nothing failed. Nothing was logged. Two of eight pictures
 * were simply of the wrong thing.
 *
 * So nobody picks a port any more. Chromium is given 0, binds whatever it can,
 * and writes the answer into its own profile directory.
 */

import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exists } from '../src/fsx';
import {
  ACTIVE_PORT_FILE,
  activePort,
  alive,
  parseActivePort,
  profileDir,
  sweep,
} from '../src/render/port';

describe('reading the port Chromium chose', () => {
  test('the first line is the port', () => {
    expect(parseActivePort('53204\n/devtools/browser/abc-123\n')).toBe(53204);
  });

  /* The file appears before it is finished. A truncated "532" is a valid
     number and a completely different port — one belonging to somebody else,
     or to nobody. */
  test('a half-written file is not an answer', () => {
    expect(parseActivePort('53204')).toBeUndefined();
    expect(parseActivePort('')).toBeUndefined();
  });

  test('nor is a line that is not a port', () => {
    expect(parseActivePort('\n/devtools/browser/abc\n')).toBeUndefined();
    expect(parseActivePort('not-a-port\n/devtools/browser/abc\n')).toBeUndefined();
    expect(parseActivePort('0\n/devtools/browser/abc\n')).toBeUndefined();
    expect(parseActivePort('70000\n/devtools/browser/abc\n')).toBeUndefined();
  });

  test('a profile with no file yet reports nothing rather than failing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'df-port-'));
    expect(await activePort(dir)).toBeUndefined();
  });

  test('and one with a written file reports the port', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'df-port-'));
    await writeFile(join(dir, ACTIVE_PORT_FILE), '61826\n/devtools/browser/xyz\n', 'utf8');

    expect(await activePort(dir)).toBe(61826);
  });
});

describe('the profile a browser is given', () => {
  /* Two sidecars in one process is ordinary — the studio holds one, an export
     starts another. Sharing a directory means the second browser finds the
     first one's lock, hands over its arguments and exits with status 0. */
  test('is never the same one twice', () => {
    const root = '/tmp/flowkit-render';
    const seen = new Set([profileDir(root), profileDir(root), profileDir(root)]);

    expect(seen.size).toBe(3);
  });

  test('and stays under the root it was given, so cleanup cannot wander', () => {
    const root = join(tmpdir(), 'flowkit-render');
    expect(profileDir(root).startsWith(root)).toBe(true);
  });

  test('naming the process that owns it', () => {
    expect(profileDir('/tmp/r')).toContain(String(process.pid));
  });
});

/* A profile is removed on the way out — when there is a way out. A hard kill
   leaves ten megabytes behind, and nothing else in the system would ever
   reclaim it. */
describe('clearing up after a browser nobody stopped', () => {
  const dead = 999_999_998; // no process has this id
  const bed = async () => await mkdtemp(join(tmpdir(), 'df-sweep-'));

  test('a profile whose process is gone is removed', async () => {
    const root = join(await bed(), 'render');
    await mkdir(`${root}-${dead}-1`, { recursive: true });
    await writeFile(join(`${root}-${dead}-1`, 'Preferences'), '{}', 'utf8');

    expect(await sweep(root)).toBe(1);
    expect(await exists(`${root}-${dead}-1`)).toBe(false);
  });

  /* The studio holds one for as long as it runs, idle between renders. */
  test('one still in use is left alone', async () => {
    const root = join(await bed(), 'render');
    await mkdir(`${root}-${process.pid}-1`, { recursive: true });

    expect(await sweep(root)).toBe(0);
    expect(await exists(`${root}-${process.pid}-1`)).toBe(true);
  });

  /* The sweep deletes directories. What it will not touch has to be exact. */
  test('and anything not named like one of ours is not touched', async () => {
    const dir = await bed();
    const root = join(dir, 'render');
    for (const name of ['render', 'render-notapid-1', `render-${dead}`, 'renderer-1-1', 'other']) {
      await mkdir(join(dir, name), { recursive: true });
    }

    expect(await sweep(root)).toBe(0);
    for (const name of ['render', 'render-notapid-1', `render-${dead}`, 'renderer-1-1', 'other']) {
      expect(await exists(join(dir, name))).toBe(true);
    }
  });

  test('a root whose parent does not exist is not an error', async () => {
    expect(await sweep(join(tmpdir(), 'df-not-here', 'render'))).toBe(0);
  });

  test('this process is alive; a made-up id is not', () => {
    expect(alive(process.pid)).toBe(true);
    expect(alive(dead)).toBe(false);
  });
});
