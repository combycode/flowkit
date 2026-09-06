/* The `locale.*` and `strings.*` domains. */

import type { Command, Diagnostic } from '../../types/commands';
import type { DomainReducer, Reduction } from '../../types/reducers';
import { diagnostic, unknown } from '../diagnostics';
import { withKey, withoutKey } from '../records';

type StringsCommand = Extract<Command, { t: `locale.${string}` | `strings.${string}` }>;

export const stringsReducer: DomainReducer<StringsCommand> = {
  domain: 'strings',

  match: (cmd): cmd is StringsCommand =>
    cmd.t.startsWith('locale.') || cmd.t.startsWith('strings.'),

  precheck(doc, cmd) {
    const out: Diagnostic[] = [];
    const locales = Object.keys(doc.strings.locales);

    if (cmd.t === 'locale.add' && doc.strings.locales[cmd.id]) {
      out.push(
        diagnostic({
          code: 'duplicate-name',
          message: `Locale "${cmd.id}" already exists. Use strings.set to change its entries.`,
        }),
      );
    }

    if (cmd.t === 'locale.delete') {
      if (!doc.strings.locales[cmd.id]) {
        out.push(unknown('unknown-locale', 'locale', cmd.id, locales));
      } else if (doc.strings.defaultLocale === cmd.id) {
        out.push(
          diagnostic({
            code: 'in-use',
            message:
              `"${cmd.id}" is the default locale — its text is what lives inline in the ` +
              'markup, so deleting it would leave the document with no source text.',
            available: locales.filter((l) => l !== cmd.id),
          }),
        );
      }
    }

    if (cmd.t === 'strings.set' && !doc.strings.locales[cmd.locale]) {
      out.push(unknown('unknown-locale', 'locale', cmd.locale, locales));
    }

    return out;
  },

  reduce(doc, cmd): Reduction {
    const strings = doc.strings;
    const withLocales = (next: typeof strings.locales) => ({
      ...doc,
      strings: { ...strings, locales: next },
    });

    switch (cmd.t) {
      case 'locale.add':
        return {
          doc: withLocales(withKey(strings.locales, cmd.id, { label: cmd.label, entries: {} })),
          inverse: [{ t: 'locale.delete', id: cmd.id }],
        };

      case 'locale.delete': {
        const before = strings.locales[cmd.id];
        if (!before) return { doc, inverse: [] };
        return {
          doc: withLocales(withoutKey(strings.locales, cmd.id)),
          inverse: [
            { t: 'locale.add', id: cmd.id, label: before.label },
            { t: 'strings.set', locale: cmd.id, entries: before.entries },
          ],
        };
      }

      case 'strings.set': {
        const before = strings.locales[cmd.locale];
        if (!before) return { doc, inverse: [] };
        return {
          // Merge by default; replace only when asked.
          doc: withLocales(
            withKey(strings.locales, cmd.locale, {
              ...before,
              entries: cmd.replace ? { ...cmd.entries } : { ...before.entries, ...cmd.entries },
            }),
          ),
          // The inverse must REPLACE. Merging the previous entries back would
          // leave every key this call added still present.
          inverse: [
            { t: 'strings.set', locale: cmd.locale, entries: before.entries, replace: true },
          ],
        };
      }
    }
  },
};
