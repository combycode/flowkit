/* Small filesystem helpers, on node: APIs rather than Bun's.
 *
 * The host package must not require Bun. A desktop shell may embed Node, and
 * tying the renderer and the exporters to one runtime would mean rewriting
 * them the day that changes. `node:` works under both.
 */

import { access, readFile } from 'node:fs/promises';

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
