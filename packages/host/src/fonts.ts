/* Fetch webfonts and embed them in the document.
 *
 * The design links Google Fonts. A composed document cannot: `srcdoc` gives it
 * no useful base, a shared project has to render offline, and — the reason
 * that actually bit — dropping the link silently fell back to system-ui, so
 * every text metric in all 62 screens was wrong while still looking plausible.
 *
 * So the bytes come into the project as assets. This is host-side because it
 * does network I/O; core only ever sees the result. Used by the importer and
 * by `add_font`, which is the same job asked for a different reason.
 *
 * Only the `latin` subset is kept. The full variable faces are several hundred
 * KB each and nothing in this design needs Cyrillic or Greek.
 */

import { createHash } from 'node:crypto';
import type { Asset, FontFace } from '@flowkit/core';

/** Google serves woff2 only to browsers it recognises; with bun's default
 *  agent it returns ttf, which is several times larger. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export interface FetchedFonts {
  fonts: FontFace[];
  assets: Record<string, Asset>;
}

interface Face {
  family: string;
  style: string;
  weight: string;
  url: string;
  range: string;
}

export async function fetchGoogleFonts(
  cssUrl: string,
  subsets: readonly string[] = ['latin', 'latin-ext'],
): Promise<FetchedFonts> {
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text();
  const wanted = pickSubsets(parseFaces(css), css, subsets);

  const fonts: FontFace[] = [];
  const assets: Record<string, Asset> = {};
  // Google emits one @font-face per weight AND per subset. For a variable
  // font several weights share a file, so assets are keyed by URL and each
  // file is stored once — without that the faces here cost 409 KB instead of
  // 136 KB, for identical copies.
  //
  // The ID has to come from the URL too. Naming it after the family and style
  // alone looks tidier and is wrong: latin and latin-ext are different files
  // with the same family and style, so the second silently overwrote the
  // first and every latin-ext face ended up pointing at the latin bytes —
  // declaring a range it could not render.
  const byUrl = new Map<string, string>();

  for (const face of wanted) {
    let id = byUrl.get(face.url);
    if (!id) {
      const bytes = new Uint8Array(
        await (await fetch(face.url, { headers: { 'User-Agent': UA } })).arrayBuffer(),
      );
      id = `font-${slug(face.family)}-${face.style}-${digest(face.url)}`;
      byUrl.set(face.url, id);
      assets[id] = {
        kind: 'font',
        mime: 'font/woff2',
        bytes: Buffer.from(bytes).toString('base64'),
        sourceUrl: face.url,
        label: `${face.family} ${face.style}`,
      };
    }
    fonts.push({
      family: face.family,
      weight: face.weight,
      style: face.style === 'italic' ? 'italic' : 'normal',
      asset: id,
      sourceUrl: face.url,
      ...(face.range ? { unicodeRange: face.range } : {}),
    });
  }

  return { fonts, assets };
}

function parseFaces(css: string): Face[] {
  const out: Face[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1] ?? '';
    const url = /src:[^;]*url\(([^)]+)\)/.exec(body)?.[1];
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    if (!url || !family) continue;
    out.push({
      family,
      style: /font-style:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400',
      url,
      range: /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '',
    });
  }
  return out;
}

/** Google labels each block with a `/* latin *\/`-style comment above it, so
 *  the subset is matched by the comment that precedes each @font-face. */
function pickSubsets(faces: Face[], css: string, subsets: readonly string[]): Face[] {
  const labels = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\//g)].map((m) => m[1]);
  return faces.filter((face, i) => {
    const label = labels[i];
    return label === undefined || subsets.includes(label);
  });
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Enough of the URL to tell two files apart, short enough to read. */
const digest = (url: string): string => createHash('sha1').update(url).digest('hex').slice(0, 8);
