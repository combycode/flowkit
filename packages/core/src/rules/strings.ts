/* String rules — the second axis that exists before there is a registry.
 *
 * Untranslatable text is not a cosmetic problem: a string with no key cannot
 * appear in any locale, so it silently stays English forever and nobody finds
 * out until a translated screen is looked at.
 */

import { diagnostic } from '../apply/diagnostics';
import { scanText } from '../html/scan';
import { rendered } from '../render/rendered';
import type { Diagnostic } from '../types/commands';
import type { Rule } from '../types/rules';
import { itemsIn } from './tokens';

const KEYS = /\sdata-t\s*=\s*["']([^"']*)["']/;

export const untranslatedText: Rule = {
  code: 'untranslated-text',
  scopes: ['item'],
  check(doc, only) {
    const out: Diagnostic[] = [];
    for (const [name, item] of itemsIn(doc, only)) {
      // A generated page's text is the tool talking about the design, not the
      // design talking to a user. Keying it would put a hundred developer
      // labels in front of a translator.
      if (item.generated) continue;

      // As it ships, not as it is stored: a key can be in one fill and the
      // text it covers in another, and only composition puts them back on the
      // same element.
      const html = rendered(doc, item);

      for (const el of scanText(html)) {
        const open = html.slice(el.openStart, el.openEnd);
        const keys = KEYS.exec(open)?.[1]?.split('|');
        if (keys && keys.length >= el.texts.length) continue;

        const sample = html.slice(el.texts[0]!.start, el.texts[0]!.end).trim().slice(0, 40);
        out.push(
          diagnostic({
            code: 'untranslated-text',
            item: name,
            message:
              `Text in <${el.tag}> has no data-t key: "${sample}". Every visible string ` +
              'needs one, or it cannot be translated.',
          }),
        );
      }
    }
    return out;
  },
};

export const missingString: Rule = {
  code: 'missing-string',
  scopes: ['item', 'strings'],
  check(doc, only) {
    const out: Diagnostic[] = [];
    const defaults = doc.strings.locales[doc.strings.defaultLocale]?.entries ?? {};

    for (const [name, item] of itemsIn(doc, only)) {
      // A generated page's text is the tool talking about the design, not the
      // design talking to a user. Keying it would put a hundred developer
      // labels in front of a translator.
      if (item.generated) continue;

      const html = rendered(doc, item);
      for (const el of scanText(html)) {
        const open = html.slice(el.openStart, el.openEnd);
        for (const key of KEYS.exec(open)?.[1]?.split('|') ?? []) {
          if (key.length > 0 && !(key in defaults)) {
            out.push(
              diagnostic({
                code: 'missing-string',
                item: name,
                message:
                  `Key "${key}" is used in "${name}" but has no entry in the default locale ` +
                  `("${doc.strings.defaultLocale}").`,
              }),
            );
          }
        }
      }
    }
    return out;
  },
};

/** Keys defined in an overlay locale that no longer exist anywhere.
 *
 *  A warning, not an error: a stale entry costs a few bytes and breaks
 *  nothing, but it is the visible sign that a re-import renumbered keys and a
 *  translation file needs revisiting. */
export const orphanedString: Rule = {
  code: 'missing-string',
  scopes: ['strings'],
  check(doc) {
    const out: Diagnostic[] = [];
    const defaults = doc.strings.locales[doc.strings.defaultLocale]?.entries ?? {};

    for (const [id, locale] of Object.entries(doc.strings.locales)) {
      if (id === doc.strings.defaultLocale) continue;
      const orphans = Object.keys(locale.entries).filter((key) => !(key in defaults));
      if (orphans.length === 0) continue;
      out.push(
        diagnostic({
          code: 'missing-string',
          severity: 'warning',
          message:
            `Locale "${id}" has ${orphans.length} entries for keys that no longer exist ` +
            '— usually the sign of a re-import that renumbered keys.',
          available: orphans.slice(0, 25),
        }),
      );
    }
    return out;
  },
};
