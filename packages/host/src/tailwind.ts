/* Running the Tailwind compiler.
 *
 * Host-side because it is a compiler: core decides WHAT to build — which
 * screens are on Tailwind and which class names they use — and this turns
 * that list into CSS.
 *
 * The compiler is handed the candidates directly rather than pointed at files
 * to scan. It is the same work either way, except that this document already
 * knows exactly where its classes are, and a scanner would have to be told
 * about a project that lives in one JSON file.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface Compiler {
  build(candidates: string[]): string;
}

type Compile = (
  css: string,
  options: {
    base: string;
    loadStylesheet: (
      id: string,
      base: string,
    ) => Promise<{ path: string; base: string; content: string }>;
    loadModule: (id: string, base: string) => Promise<unknown>;
  },
) => Promise<Compiler>;

/** Compile one stylesheet from an entry and a list of candidates. */
export async function compileTailwind(
  input: string,
  candidates: readonly string[],
): Promise<string> {
  const { compile } = (await import('tailwindcss')) as unknown as { compile: Compile };

  // `@import "tailwindcss"` resolves inside the installed package, so every
  // path is anchored there rather than at whatever the project happens to be.
  const entry = require.resolve('tailwindcss/index.css');
  const home = dirname(entry);

  const compiler = await compile(input, {
    base: home,
    loadStylesheet: async (id, base) => {
      const path = id.startsWith('.')
        ? resolve(base, id)
        : require.resolve(id.endsWith('.css') ? id : `${id}/index.css`, { paths: [base, home] });
      return { path, base: dirname(path), content: await readFile(path, 'utf8') };
    },
    loadModule: async (id) => {
      // Plugins would mean running somebody's code as part of a design build.
      throw new Error(`This build does not load plugins (${id}).`);
    },
  });

  return compiler.build([...candidates]);
}

/** The version of the compiler that produced a sheet, for the header. */
export async function tailwindVersion(): Promise<string> {
  const path = require.resolve('tailwindcss/package.json');
  const meta = JSON.parse(await readFile(path, 'utf8')) as { version?: string };
  return meta.version ?? 'unknown';
}
