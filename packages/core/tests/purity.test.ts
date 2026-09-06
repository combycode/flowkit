/* Core must stay portable: the viewer, the MCP server, the sidecar and a
 * future browser host all reuse it, and any one Node or DOM import breaks
 * three of the four.
 *
 * `lib: ["es2023"]` in tsconfig already stops DOM globals from typechecking.
 * This catches the other half — `node:` imports, which typecheck fine and
 * fail only at runtime in a browser, i.e. exactly the failure that would be
 * found latest and hurt most.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('core purity', () => {
  const files = sources(SRC);

  test('finds source files at all (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(SRC.length + 1);
    const body = readFileSync(file, 'utf8');

    test(`${rel} imports no node: builtin`, () => {
      // Import statements only — the string "node:" inside a comment is fine.
      const hits = [...body.matchAll(/(?:from|import)\s*\(?\s*['"](node:[^'"]+)['"]/g)].map(
        (m) => m[1],
      );
      expect(hits).toEqual([]);
    });

    test(`${rel} reaches for no DOM global`, () => {
      /* Comments go, and so does the SCRIPT a generated page carries.
       *
       * A kit sheet ships a few lines that run in the browser showing it —
       * they fill a frame with the shell it previews. Here those lines are
       * data: core writes them into a page, it never runs them. Stripping the
       * <script> is what lets this check tell shipping a script apart from
       * calling one. */
      const stripped = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/<script>[\s\S]*?<\/script>/g, '');
      const hits = [
        ...stripped.matchAll(/\b(document|window|navigator|localStorage|DOMParser)\s*\./g),
      ].map((m) => m[1]);
      expect(hits).toEqual([]);
    });
  }
});
