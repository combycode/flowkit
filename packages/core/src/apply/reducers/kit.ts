/* The `kit.*`, `sheet.*`, `theme.*` and `font.*` domains — the styling
 * substrate. */

import type { Command, Diagnostic } from '../../types/commands';
import type { FontFace } from '../../types/project';
import type { DomainReducer, Reduction } from '../../types/reducers';
import { diagnostic, unknown } from '../diagnostics';
import { withKey, withoutKey } from '../records';

type KitCommand = Extract<
  Command,
  { t: `kit.${string}` | `sheet.${string}` | `theme.${string}` | `font.${string}` }
>;

/** The same FACE, not merely the same family and weight.
 *
 *  A family arrives as several files that differ only by which characters they
 *  cover, and the browser picks between them per glyph. Keyed without the
 *  range, adding `latin-ext` replaces `latin` and a language silently loses
 *  its accented characters. */
const sameFace = (
  a: FontFace,
  b: { family: string; weight: string; style: string; unicodeRange?: string },
) =>
  a.family === b.family &&
  a.weight === b.weight &&
  a.style === b.style &&
  a.unicodeRange === b.unicodeRange;

/** Every subset of one face — what `font.delete` removes when it is not told
 *  a particular range. */
const sameCut = (a: FontFace, b: { family: string; weight: string; style: string }) =>
  a.family === b.family && a.weight === b.weight && a.style === b.style;

export const kitReducer: DomainReducer<KitCommand> = {
  domain: 'kit',

  match: (cmd): cmd is KitCommand =>
    cmd.t.startsWith('kit.') ||
    cmd.t.startsWith('sheet.') ||
    cmd.t.startsWith('theme.') ||
    cmd.t.startsWith('font.'),

  precheck(doc, cmd) {
    const out: Diagnostic[] = [];
    const themes = Object.keys(doc.kit.themes);

    if (cmd.t === 'theme.setToken' && !doc.kit.themes[cmd.theme]) {
      out.push(unknown('unknown-theme', 'theme', cmd.theme, themes));
    }

    if (cmd.t === 'theme.delete') {
      if (!doc.kit.themes[cmd.id]) {
        out.push(unknown('unknown-theme', 'theme', cmd.id, themes));
      } else if (themes.length <= 1) {
        out.push(
          diagnostic({
            code: 'in-use',
            message: 'Cannot delete the only theme; a document must have at least one.',
          }),
        );
      } else if (doc.kit.defaultTheme === cmd.id) {
        out.push(
          diagnostic({
            code: 'in-use',
            message: `"${cmd.id}" is the default theme. Point defaultTheme elsewhere first.`,
            available: themes.filter((t) => t !== cmd.id),
          }),
        );
      }
    }

    if (cmd.t === 'sheet.delete') {
      const sheets = Object.keys(doc.kit.sheets);
      const users = Object.entries(doc.items)
        .filter(([, item]) => (item.sheets ?? []).includes(cmd.name))
        .map(([name]) => name);

      if (!doc.kit.sheets[cmd.name]) {
        out.push(unknown('unknown-item', 'sheet', cmd.name, sheets));
      } else if (users.length > 0) {
        // Deleting it would leave those screens asking for a stylesheet that
        // is not there, and they would render unstyled without erroring.
        out.push(
          diagnostic({
            code: 'in-use',
            message:
              `"${cmd.name}" is still used by ${users.length} item(s). ` +
              'Point them elsewhere first, or the screens lose their styling silently.',
            available: users,
          }),
        );
      }
    }

    if (cmd.t === 'font.add' && !doc.assets[cmd.asset]) {
      out.push(unknown('unknown-asset', 'asset', cmd.asset, Object.keys(doc.assets)));
    }

    return out;
  },

  reduce(doc, cmd): Reduction {
    const kit = doc.kit;
    const withKit = (next: Partial<typeof kit>) => ({ ...doc, kit: { ...kit, ...next } });

    switch (cmd.t) {
      case 'kit.setBase':
        return { doc: withKit({ base: cmd.css }), inverse: [{ t: 'kit.setBase', css: kit.base }] };

      case 'sheet.set': {
        const before = kit.sheets[cmd.name];
        return {
          doc: withKit({ sheets: withKey(kit.sheets, cmd.name, cmd.css) }),
          inverse: [
            before === undefined
              ? { t: 'sheet.delete', name: cmd.name }
              : { t: 'sheet.set', name: cmd.name, css: before },
          ],
        };
      }

      case 'sheet.delete': {
        const before = kit.sheets[cmd.name];
        if (before === undefined) return { doc, inverse: [] };
        return {
          doc: withKit({ sheets: withoutKey(kit.sheets, cmd.name) }),
          inverse: [{ t: 'sheet.set', name: cmd.name, css: before }],
        };
      }

      case 'kit.setPreset':
        return {
          doc: withKit({ preset: cmd.preset }),
          inverse: [{ t: 'kit.setPreset', preset: kit.preset }],
        };

      case 'theme.set': {
        const before = kit.themes[cmd.id];
        return {
          doc: withKit({ themes: withKey(kit.themes, cmd.id, cmd.theme) }),
          inverse: [
            before
              ? { t: 'theme.set', id: cmd.id, theme: before }
              : { t: 'theme.delete', id: cmd.id },
          ],
        };
      }

      case 'theme.setToken': {
        const theme = kit.themes[cmd.theme];
        if (!theme) return { doc, inverse: [] };
        const before = theme.tokens[cmd.token];
        return {
          doc: withKit({
            themes: withKey(kit.themes, cmd.theme, {
              ...theme,
              tokens: withKey(theme.tokens, cmd.token, cmd.value),
            }),
          }),
          // Restoring the whole theme covers the case where the token did not
          // exist before, which a setToken inverse could not express.
          inverse:
            before === undefined
              ? [{ t: 'theme.set', id: cmd.theme, theme }]
              : [{ t: 'theme.setToken', theme: cmd.theme, token: cmd.token, value: before }],
        };
      }

      case 'theme.removeToken': {
        const theme = kit.themes[cmd.theme];
        if (!theme) return { doc, inverse: [] };
        const before = theme.tokens[cmd.token];
        if (before === undefined) return { doc, inverse: [] };
        return {
          doc: withKit({
            themes: withKey(kit.themes, cmd.theme, {
              ...theme,
              tokens: withoutKey(theme.tokens, cmd.token),
            }),
          }),
          inverse: [{ t: 'theme.setToken', theme: cmd.theme, token: cmd.token, value: before }],
        };
      }

      case 'kit.setDefaultTheme':
        return {
          doc: withKit({ defaultTheme: cmd.theme }),
          inverse: [{ t: 'kit.setDefaultTheme', theme: kit.defaultTheme }],
        };

      case 'theme.delete': {
        const before = kit.themes[cmd.id];
        if (!before) return { doc, inverse: [] };
        return {
          doc: withKit({ themes: withoutKey(kit.themes, cmd.id) }),
          inverse: [{ t: 'theme.set', id: cmd.id, theme: before }],
        };
      }

      case 'font.add': {
        const face: FontFace = {
          family: cmd.family,
          weight: cmd.weight,
          style: cmd.style,
          asset: cmd.asset,
          ...(cmd.sourceUrl !== undefined ? { sourceUrl: cmd.sourceUrl } : {}),
          ...(cmd.unicodeRange !== undefined ? { unicodeRange: cmd.unicodeRange } : {}),
        };
        return {
          doc: withKit({ fonts: [...kit.fonts.filter((f) => !sameFace(f, cmd)), face] }),
          inverse: [
            {
              t: 'font.delete',
              family: cmd.family,
              weight: cmd.weight,
              style: cmd.style,
              ...(cmd.unicodeRange !== undefined ? { unicodeRange: cmd.unicodeRange } : {}),
            },
          ],
        };
      }

      case 'font.delete': {
        // Without a range this means the whole face, subsets and all —
        // otherwise removing a font would leave some of its files behind.
        const matches = (f: FontFace) =>
          cmd.unicodeRange === undefined ? sameCut(f, cmd) : sameFace(f, cmd);

        const going = kit.fonts.filter(matches);
        if (going.length === 0) return { doc, inverse: [] };

        return {
          doc: withKit({ fonts: kit.fonts.filter((f) => !matches(f)) }),
          inverse: going.map((before) => ({
            t: 'font.add' as const,
            asset: before.asset,
            family: before.family,
            weight: before.weight,
            style: before.style,
            ...(before.sourceUrl !== undefined ? { sourceUrl: before.sourceUrl } : {}),
            ...(before.unicodeRange !== undefined ? { unicodeRange: before.unicodeRange } : {}),
          })),
        };
      }
    }
  },
};
