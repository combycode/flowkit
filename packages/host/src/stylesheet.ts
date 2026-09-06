/* Bring a stylesheet into the project — a framework, a theme, somebody's CSS.
 *
 * By VALUE, never by reference. A composed screen has no useful base URL, a
 * shared snapshot has to render with nothing behind it, and a link that fails
 * to load leaves a page that still looks plausible and is wrong everywhere —
 * the same reason webfonts come in as bytes rather than as a `<link>`.
 *
 * So this reads the CSS, follows its `@import`s, and pulls the files its
 * `url()`s point at into the text as data URIs. What comes back is one string
 * that renders offline: the whole point of the exercise.
 *
 * Host-side because it does network and disk I/O. Core only ever sees CSS.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface FetchedStylesheet {
  css: string;
  /** Where it came from, as given. */
  source: string;
  /** Of the bytes as fetched, before anything was inlined. */
  sha256: string;
  bytes: { fetched: number; stored: number };
  /** Files pulled into the text. */
  inlined: number;
  /** Older font formats left as links because a modern one was taken. */
  skipped: number;
  /** References left alone, with why. A stylesheet that still points outside
   *  itself is the failure this exists to prevent, so it is reported rather
   *  than swallowed. */
  left: string[];
}

/** How big a single referenced file may be before it is left as a link. */
const ASSET_LIMIT = 512 * 1024;
/** And how much of them altogether. */
const TOTAL_LIMIT = 6 * 1024 * 1024;
/** `@import` chains are usually one deep; three is already generous. */
const MAX_DEPTH = 3;

const TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

const isUrl = (source: string): boolean => /^https?:\/\//i.test(source);

/** Read one file, from the web or from disk. */
async function read(source: string): Promise<Uint8Array> {
  if (isUrl(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${source}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  return new Uint8Array(await readFile(resolve(source)));
}

/** Resolve a reference against the stylesheet that mentions it. */
function against(base: string, ref: string): string {
  if (isUrl(ref)) return ref;
  if (isUrl(base)) return new URL(ref, base).toString();
  return resolve(dirname(resolve(base)), ref);
}

export async function fetchStylesheet(source: string): Promise<FetchedStylesheet> {
  const bytes = await read(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fetched = new TextDecoder().decode(bytes);

  const state: State = { inlined: 0, spent: 0, skipped: new Set(), left: new Set() };
  const css = await follow(fetched, source, 0, state);

  return {
    css,
    source,
    sha256,
    bytes: { fetched: bytes.length, stored: new TextEncoder().encode(css).length },
    inlined: state.inlined,
    skipped: state.skipped.size,
    left: [...state.left],
  };
}

interface State {
  inlined: number;
  spent: number;
  /* By reference rather than by count: inlining runs once per file and again
   * over the assembled text, so a link that is passed over is met twice and
   * would be counted twice. */
  skipped: Set<string>;
  left: Set<string>;
}

/** The formats a `@font-face` offers, best first.
 *
 *  A `src` list is tried in order and a broken entry is simply skipped, so
 *  leaving the others as links costs nothing — while inlining them costs
 *  plenty: PrimeIcons ships the same icon font six ways, and taking all six
 *  turned 17KB of CSS into 952KB. */
const FONTS = new Set(['woff2', 'woff', 'ttf', 'otf', 'eot']);

/** Pull in `@import`s, then inline what `url()` points at. */
async function follow(css: string, base: string, depth: number, state: State): Promise<string> {
  const imports = [...css.matchAll(/@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?[^;]*;/g)];

  let out = css;
  for (const found of imports) {
    const ref = found[1];
    if (ref === undefined || ref.startsWith('data:')) continue;

    if (depth >= MAX_DEPTH) {
      state.left.add(`${ref} (@import nested deeper than ${MAX_DEPTH})`);
      continue;
    }

    try {
      const at = against(base, ref);
      const nested = new TextDecoder().decode(await read(at));
      out = out.replace(found[0], await follow(nested, at, depth + 1, state));
    } catch (e) {
      state.left.add(`${ref} (${(e as Error).message})`);
    }
  }

  return await inlineUrls(out, base, state);
}

async function inlineUrls(css: string, base: string, state: State): Promise<string> {
  const refs = [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)];
  const done = new Map<string, string>();

  const extOf = (ref: string) => (ref.split(/[?#]/)[0] ?? '').split('.').pop()?.toLowerCase() ?? '';

  /* One face is enough, and woff2 is the one: every browser that matters reads
   * it, and taking woff as well doubles the bytes for a fallback nothing will
   * reach. Whatever else the sheet offers becomes a link. */
  const best = refs.some((found) => extOf(found[2] ?? '') === 'woff2') ? 'woff2' : 'woff';
  const older = (ext: string) => FONTS.has(ext) && ext !== best;

  for (const found of refs) {
    const ref = found[2];
    if (ref === undefined || ref.startsWith('data:') || ref.startsWith('#')) continue;
    if (done.has(ref)) continue;

    const ext = extOf(ref);
    const type = TYPES[ext];
    if (!type) {
      state.left.add(`${ref} (not a kind of file this inlines)`);
      continue;
    }
    /* An icon font in svg is a font; an illustration in svg is a picture. What
     * tells them apart here is whether the sheet also offers a real face — if
     * it does, the svg is the last entry of the same `src` list. */
    if (older(ext) || (ext === 'svg' && refs.some((f) => FONTS.has(extOf(f[2] ?? ''))))) {
      state.skipped.add(ref);
      continue;
    }

    try {
      const bytes = await read(against(base, ref));
      if (bytes.length > ASSET_LIMIT || state.spent + bytes.length > TOTAL_LIMIT) {
        state.left.add(`${ref} (${Math.round(bytes.length / 1024)}KB — over the limit)`);
        continue;
      }

      done.set(ref, `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
      state.spent += bytes.length;
      state.inlined += 1;
    } catch (e) {
      state.left.add(`${ref} (${(e as Error).message})`);
    }
  }

  let out = css;
  for (const [ref, data] of done) out = out.split(ref).join(data);
  return out;
}

/** The line that says where this came from.
 *
 *  In the CSS itself rather than in a field beside it: a stylesheet gets
 *  copied, diffed and pasted, and the provenance should travel with it. */
export function provenance(fetched: FetchedStylesheet, at: Date): string {
  return (
    `/* ${fetched.source}\n` +
    `   fetched ${at.toISOString().slice(0, 10)} — sha256 ${fetched.sha256.slice(0, 16)}\n` +
    `   ${Math.round(fetched.bytes.fetched / 1024)}KB as fetched` +
    `${fetched.inlined > 0 ? `, ${fetched.inlined} file(s) inlined` : ''}` +
    `${fetched.skipped > 0 ? `, ${fetched.skipped} older font format(s) left as links` : ''} */\n`
  );
}
