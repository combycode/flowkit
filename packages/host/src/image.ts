/* Reading a picture in, so a screen can be a mockup.
 *
 * Host-side because it touches the disk and the network, which core does not.
 * By value like everything else the document holds: a project has to render
 * offline and survive being handed to somebody as one file, so a screenshot
 * that lives at a path on this machine is no use to anybody else.
 */

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

export interface LoadedImage {
  mime: string;
  /** base64, as `Asset.bytes` wants it. */
  bytes: string;
  /** What it cost the document, in bytes of image rather than of base64. */
  size: number;
  label: string;
}

/** By extension. A wrong content-type from a server is a real failure mode and
 *  the extension is what the person actually chose. */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export function mimeOf(source: string): string | undefined {
  const clean = source.split(/[?#]/)[0] ?? source;
  return MIME[extname(clean).toLowerCase()];
}

/** Read a picture from a path or a URL. */
export async function loadImage(source: string): Promise<LoadedImage> {
  const mime = mimeOf(source);
  if (!mime) {
    throw new Error(
      `Cannot tell what kind of picture "${source}" is. Give it one of: ` +
        `${Object.keys(MIME).join(', ')}.`,
    );
  }

  const bytes = /^https?:\/\//i.test(source)
    ? new Uint8Array(await (await fetchOk(source)).arrayBuffer())
    : new Uint8Array(await readFile(resolve(source)));

  const label = (source.split(/[\\/]/).pop() ?? source).split(/[?#]/)[0] ?? source;
  return {
    mime,
    bytes: Buffer.from(bytes).toString('base64'),
    size: bytes.byteLength,
    label,
  };
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}.`);
  return res;
}
