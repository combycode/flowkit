/* Host side of the STRAIW import: file I/O only.
 *
 * Everything that transforms anything lives in @flowkit/core and is pure.
 * This reads bytes, calls it, and writes the result — so the same import runs
 * in a test, and later in a browser drop-target, with no logic duplicated.
 *
 *   bun run tools/import-straiw.ts [--src <dir>] [--out <file>]
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { FlowGroup } from '../packages/core/src/index';
import { importStraiw, parseScreens, type SourceScreen } from '../packages/core/src/index';
import { fetchGoogleFonts } from '../packages/host/src/fonts';
import { workspaceDir } from '../packages/host/src/paths';
import { buildLocale } from './build-locale';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const SRC = resolve(arg('src', 'D:/WORKSPACE/STRAIW/STRAIW_Chat'));
const OUT = resolve(arg('out', join(workspaceDir(), 'straiw-chat.json')));

/** STRAIW's own grouping, taken from the filter bar in design/index.html. */
const GROUPS: FlowGroup[] = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'cabinet', label: 'Awaiting' },
  { id: 'review', label: 'Reviewing' },
  { id: 'ops', label: 'Operator' },
  { id: 'worker', label: 'Worker' },
  { id: 'expert', label: 'Knowledge' },
];

/* Grouping, order, titles and captions come from the SCREENS array in
 * design/index.html. That is metadata the design already maintains by hand:
 * the flows do not line up with the filename numbers, and the captions are
 * written design notes that no heuristic could reproduce. */

/** Pages that are not product screens: the contact sheet and the marketing
 *  artboards, which are a different kind of thing at a different size. */
/* Exactly the families the design links. */
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap';

const NOT_A_SCREEN = /^(index|uikit|m1-.*)$/;

async function main() {
  const design = join(SRC, 'design');
  const styles = join(SRC, 'packages', 'styles', 'src');

  const names = (await readdir(design))
    .filter((f) => f.endsWith('.html'))
    .map((f) => basename(f, '.html'))
    .filter((n) => !NOT_A_SCREEN.test(n))
    .sort();

  const meta = new Map(
    parseScreens(await readFile(join(design, 'index.html'), 'utf8')).map((m) => [m.file, m]),
  );

  const screens: SourceScreen[] = await Promise.all(
    names.map(async (name) => {
      const m = meta.get(name);
      return {
        name,
        html: await readFile(join(design, `${name}.html`), 'utf8'),
        ...(m ? { group: m.group, order: m.order, title: m.title } : {}),
        ...(m?.caption ? { description: m.caption } : {}),
      };
    }),
  );

  const missing = names.filter((n) => !meta.has(n));
  if (missing.length > 0) {
    console.warn(`no flow metadata for ${missing.length}: ${missing.join(', ')}`);
  }

  const cssFiles = (await readdir(styles)).filter((f) => f.endsWith('.css'));
  const css = Object.fromEntries(
    await Promise.all(
      cssFiles.map(async (f) => [basename(f, '.css'), await readFile(join(styles, f), 'utf8')]),
    ),
  );

  const { fonts, assets } = await fetchGoogleFonts(FONTS_URL);

  const base = {
    projectName: 'STRAIW Chat',
    screens,
    css,
    groups: GROUPS,
    fonts,
    assets,
    now: () => new Date().toISOString(),
    // A readable id, not a UUID: this is what someone passes to project=,
    // and what names the folder an export lands in.
    newId: () => basename(OUT, '.json'),
  };

  // Two passes: the first extracts the English strings, which is what the
  // translation file is keyed against. Cheap — the import is pure and fast —
  // and it keeps translations authored against readable text rather than
  // against keys that a re-import could renumber.
  const english = importStraiw(base).strings.locales.en?.entries ?? {};
  const ru = buildLocale(
    'Русский',
    (await Bun.file(join(import.meta.dir, 'locales', 'ru.json')).json()) as Record<string, string>,
    english,
  );

  const doc = importStraiw({ ...base, locales: { ru: ru.locale } });
  console.log(
    `strings   ${Object.keys(english).length} keys, ru covers ${ru.translated} ` +
      `(${((ru.translated / ru.total) * 100).toFixed(0)}%)`,
  );

  await mkdir(dirname(OUT), { recursive: true });
  const json = JSON.stringify(doc);
  await writeFile(OUT, json, 'utf8');

  console.log(`screens   ${Object.keys(doc.items).length}`);
  console.log(`sheets    ${Object.keys(doc.kit.sheets).join(', ')}`);
  console.log(
    `themes    ${Object.keys(doc.kit.themes).join(', ')} ` +
      `(${Object.keys(doc.kit.themes.dark?.tokens ?? {}).length} tokens)`,
  );
  console.log(`groups    ${doc.flow.groups.map((g) => g.id).join(', ')}`);
  console.log(`size      ${(json.length / 1024).toFixed(0)} KB  ->  ${OUT}`);
}

await main();
