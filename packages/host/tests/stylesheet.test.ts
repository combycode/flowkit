/* Bringing a stylesheet in by value.
 *
 * All local: a test that reaches the network fails on a train, and what is
 * being checked here — following imports, inlining what url() points at,
 * taking one font face rather than six — has nothing to do with where the
 * bytes came from.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchStylesheet, provenance } from '../src/stylesheet';

let dir: string;
const at = (name: string) => join(dir, name);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-sheet-'));

  await writeFile(at('pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await writeFile(at('face.woff2'), Buffer.from('woff2-bytes'));
  await writeFile(at('face.ttf'), Buffer.from('ttf-bytes'));
  await writeFile(at('huge.png'), Buffer.alloc(600 * 1024, 7));

  await writeFile(
    at('fonts.css'),
    `@font-face {
       font-family: Test;
       src: url(./face.woff2) format('woff2'), url(./face.ttf) format('truetype');
     }`,
  );
  await writeFile(
    at('main.css'),
    `@import "./fonts.css";
     .a { background: url(./pic.png) }
     .b { background: url("./huge.png") }
     .c { background: url(./missing.png) }
     .d { background: url(data:image/gif;base64,AAAA) }`,
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('fetchStylesheet', () => {
  test('follows an import and leaves none behind', async () => {
    const out = await fetchStylesheet(at('main.css'));

    expect(out.css).toContain('font-family: Test');
    expect(out.css).not.toContain('@import');
  });

  test('inlines what it can reach', async () => {
    const out = await fetchStylesheet(at('main.css'));

    expect(out.css).toContain('data:image/png;base64,');
    expect(out.css).toContain('data:font/woff2;base64,');
    expect(out.inlined).toBe(2);
  });

  /* A src list is tried in order and a broken entry is simply skipped, so the
     older formats cost nothing as links — and plenty as bytes. */
  test('takes one font face and leaves the rest as links', async () => {
    const out = await fetchStylesheet(at('main.css'));

    expect(out.css).toContain('./face.ttf');
    expect(out.css).not.toContain('data:font/ttf');
    expect(out.skipped).toBe(1);
  });

  /* The whole point is a stylesheet that renders with nothing behind it, so
     anything still pointing outside is said out loud rather than swallowed. */
  test('says what it could not bring in, and why', async () => {
    const out = await fetchStylesheet(at('main.css'));

    expect(out.left.some((l) => l.includes('missing.png'))).toBe(true);
    expect(out.left.some((l) => l.includes('huge.png') && l.includes('over the limit'))).toBe(true);
  });

  test('a data: url is already inside', async () => {
    const out = await fetchStylesheet(at('main.css'));

    expect(out.css).toContain('data:image/gif;base64,AAAA');
    expect(out.left.some((l) => l.includes('data:image/gif'))).toBe(false);
  });

  test('reports what it fetched and what it stored', async () => {
    const out = await fetchStylesheet(at('main.css'));

    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.bytes.stored).toBeGreaterThan(out.bytes.fetched);
  });

  test('a source that is not there fails rather than storing nothing', async () => {
    expect(fetchStylesheet(at('nope.css'))).rejects.toThrow();
  });
});

describe('provenance', () => {
  /* In the CSS itself: a stylesheet gets copied, diffed and pasted, and where
     it came from should travel with it. */
  test('says where it came from, when, and what it was', async () => {
    const out = await fetchStylesheet(at('main.css'));
    const header = provenance(out, new Date('2026-09-03T10:00:00Z'));

    expect(header).toContain('main.css');
    expect(header).toContain('2026-09-03');
    expect(header).toContain(out.sha256.slice(0, 16));
    expect(header).toContain('inlined');
  });
});
