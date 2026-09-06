/* Turn a text-keyed translation file into a key-keyed locale overlay.
 *
 * Translations are authored against the ENGLISH TEXT, not against extracted
 * keys: 927 distinct texts back 2211 keys, so "Brief" is translated once and
 * lands on all 22 keys that hold it. It also means the file survives a
 * re-import that renumbers keys.
 *
 * Anything untranslated is simply absent from the overlay, and the renderer
 * falls back to the inline English — so partial coverage renders correctly
 * rather than leaving holes.
 */

import type { Locale } from '../packages/core/src/index';

export interface LocaleBuild {
  locale: Locale;
  translated: number;
  total: number;
}

export function buildLocale(
  label: string,
  byText: Readonly<Record<string, string>>,
  englishEntries: Readonly<Record<string, string>>,
): LocaleBuild {
  const entries: Record<string, string> = {};
  for (const [key, english] of Object.entries(englishEntries)) {
    const ru = byText[english];
    if (ru !== undefined) entries[key] = ru;
  }
  return {
    locale: { label, entries },
    translated: Object.keys(entries).length,
    total: Object.keys(englishEntries).length,
  };
}
