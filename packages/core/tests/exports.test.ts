/* The barrel is the whole package's front door, and a duplicate re-export in it
 * is a bun PARSE error that crashes the server on a cold start — yet it slips
 * past typecheck, the unit tests and the bundle build, because bun serves a
 * cached transpile of an earlier good state. This reads the source directly, so
 * it catches the duplicate whatever the cache is doing. */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const index = readFileSync(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf8');

/** Every name a `export { … }` / `export type { … }` block binds, using the
 *  alias after `as` when there is one — that is the name actually exported. */
function reExported(src: string): string[] {
  const names: string[] = [];
  for (const block of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const raw of (block[1] ?? '').split(',')) {
      const spec = raw.trim();
      if (!spec) continue;
      const asAt = / as /.exec(spec);
      names.push((asAt ? spec.slice(asAt.index + 4) : spec).trim());
    }
  }
  return names;
}

describe('the core barrel', () => {
  test('exports no name twice — a duplicate crashes the server on cold start', () => {
    const names = reExported(index);
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const n of names) {
      if (seen.has(n)) dup.push(n);
      else seen.add(n);
    }
    expect(dup).toEqual([]);
  });
});
