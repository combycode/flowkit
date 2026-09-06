/* Strings: reading them, sending them out, taking them back.
 *
 * Until now they could only be WRITTEN. `set_strings` and `add_locale` existed
 * and nothing read a word back, so an agent could not check wording, could not
 * see what was untranslated, and could not translate anything — it had no way
 * to know what the text said.
 *
 * Export and import are two jobs, not one:
 *
 *   json   one language, every key, key for key — what an application loads.
 *   csv    source beside target, for a person with a spreadsheet.
 *   xliff  the same, in what a translation agency takes.
 *
 * CSV and XLIFF deduplicate by default. STRAIW holds 2211 keys and 927
 * distinct texts; sending the long form means paying to translate "Brief"
 * twenty-two times and getting twenty-two chances at a different answer.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Command, StringFormat } from '@flowkit/core';
import { extractStrings, parseStrings, stringUnits, writeStrings } from '@flowkit/core';
import { exportDir, type Workspace } from '@flowkit/host';
import { z } from 'zod';
import { failure, fromResult, type ToolReply, text } from '../reply';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

export function registerStringTools(server: Registrar, ws: Workspace): void {
  register(server, ws, tools());
}

const FORMATS = ['json', 'csv', 'xliff'] as const;

const EXTENSION: Record<StringFormat, string> = { json: 'json', csv: 'csv', xliff: 'xlf' };

function tools(): ToolSpec[] {
  return [
    {
      name: 'get_strings',
      config: {
        title: 'Read the text of a project',
        description:
          'The keyed strings and what they say. Source text comes from the markup, which is ' +
          'where the default language actually lives. ' +
          'Narrow it: `screen` for one screen, `missing` for what a locale has not translated ' +
          'yet, `search` for wording. A project can hold thousands of keys, so this is capped ' +
          'and says when it truncated.',
        inputSchema: {
          locale: z.string().optional(),
          screen: z.string().optional(),
          missing: z.boolean().optional(),
          search: z.string().optional(),
          limit: z.number().optional(),
        },
      },
      run: (
        args: {
          locale?: string;
          screen?: string;
          missing?: boolean;
          search?: string;
          limit?: number;
        },
        ctx: ToolContext,
      ): ToolReply => {
        const doc = ctx.store.get();
        const locale = args.locale ?? doc.strings.defaultLocale;
        if (!doc.strings.locales[locale]) {
          return failure(
            `No locale "${locale}". Available: ${Object.keys(doc.strings.locales).join(', ')}.`,
          );
        }

        const all = stringUnits(doc, { locale });
        const needle = args.search?.toLowerCase();
        const matching = all.filter((u) => {
          if (args.screen && !u.uses.some((p) => p.item === args.screen)) return false;
          if (args.missing && u.target !== undefined) return false;
          if (needle && !u.source.toLowerCase().includes(needle)) return false;
          return true;
        });

        if (matching.length === 0) return text('Nothing matches.');

        const limit = args.limit ?? 60;
        const shown = matching.slice(0, limit);
        const isDefault = locale === doc.strings.defaultLocale;

        return text(
          [
            `${matching.length} string(s)${matching.length > shown.length ? `, showing ${shown.length}` : ''}` +
              ` — ${locale}${isDefault ? ' (the source language)' : ''}.`,
            '',
            ...shown.map((u) => {
              const where = [...new Set(u.uses.map((p) => p.item))].slice(0, 3).join(', ');
              const value = isDefault ? u.source : (u.target ?? '— untranslated —');
              return `${u.keys[0]}\n    ${value}${isDefault ? '' : `\n    en: ${u.source}`}${
                where ? `\n    in: ${where}` : ''
              }`;
            }),
            matching.length > shown.length ? `\n…and ${matching.length - shown.length} more.` : '',
          ]
            .filter((l) => l !== '')
            .join('\n'),
        );
      },
    },

    {
      name: 'extract_strings',
      config: {
        title: 'Give every visible string a key',
        description:
          'Scans a screen for text that has no data-t and stamps one on, registering the text ' +
          'as the default language. Run it after sketching a screen in plain markup: writing ' +
          'the keys by hand is tedious and the validator complains about every line missed. ' +
          'It ALSO backfills: text you keyed by hand but never gave a string to gets its entry ' +
          'filled from the markup — so a hand-written data-t no longer sits on a missing-string ' +
          'warning. An entry that already exists is left untouched, so this is safe to re-run.',
        inputSchema: { name: z.string(), prefix: z.string().optional() },
      },
      writes: true,
      run: async (
        args: { name: string; prefix?: string },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const item = doc.items[args.name];
        if (!item) {
          return failure(
            `No item "${args.name}". Available: ${Object.keys(doc.items).join(', ') || 'none'}.`,
          );
        }

        // The keys the default locale already has, so a set translation is
        // never overwritten and only genuine gaps are filled.
        const locale = doc.strings.defaultLocale;
        const existing = new Set(Object.keys(doc.strings.locales[locale]?.entries ?? {}));
        const found = extractStrings(item.html, args.prefix ?? args.name, existing);

        if (found.keyed === 0 && found.backfilled === 0) {
          return text(
            `Nothing to do — every visible string in "${args.name}" has a key and an entry.`,
          );
        }

        // Markup and entries together, or not at all: a key stamped into the
        // html with no entry behind it is a string that cannot be translated
        // and does not show up as missing either. Backfill-only runs change no
        // markup, so the setHtml is skipped when nothing was newly keyed.
        const commands: Command[] = [];
        if (found.keyed > 0)
          commands.push({ t: 'item.setHtml', name: args.name, html: found.html });
        if (Object.keys(found.entries).length > 0) {
          commands.push({ t: 'strings.set', locale, entries: found.entries });
        }

        const parts = [
          found.keyed > 0 ? `keyed ${found.keyed} new string(s)` : '',
          found.backfilled > 0 ? `filled ${found.backfilled} missing entry(ies)` : '',
        ].filter(Boolean);

        return ctx.store
          .runAll(commands)
          .then((r) =>
            fromResult(
              r,
              `In "${args.name}": ${parts.join(', ')}.\n` +
                'Translate them with export_strings, or read them with get_strings.',
            ),
          );
      },
    },

    {
      name: 'export_strings',
      config: {
        title: 'Write the text out as a file',
        description:
          'json: one language, every key, key for key — what an application loads. ' +
          'csv and xliff: source beside target with the screen and element each string ' +
          'appears in, for a person or an agency to translate. ' +
          'Those two DEDUPLICATE by default — the same sentence is written once however many ' +
          'keys hold it, which is both cheaper to translate and more consistent. Pass ' +
          'dedupe=false for one row per key. Lands beside the project unless `out` says.',
        inputSchema: {
          format: z.enum(FORMATS),
          locale: z.string().optional(),
          dedupe: z.boolean().optional(),
          out: z.string().optional(),
        },
      },
      run: async (
        args: { format: StringFormat; locale?: string; dedupe?: boolean; out?: string },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const locale = args.locale ?? doc.strings.defaultLocale;
        if (!doc.strings.locales[locale]) {
          return failure(
            `No locale "${locale}". Available: ${Object.keys(doc.strings.locales).join(', ')}. ` +
              'add_locale makes one.',
          );
        }

        // JSON is what an application loads: it asks for a key by name, so
        // there is nothing to deduplicate.
        const dedupe = args.format === 'json' ? false : (args.dedupe ?? true);
        const units = stringUnits(doc, { locale, dedupe });

        const body = writeStrings(units, {
          format: args.format,
          locale,
          sourceLocale: doc.strings.defaultLocale,
        });

        const out =
          args.out ??
          join(exportDir(ctx.path), 'strings', `${ctx.id}.${locale}.${EXTENSION[args.format]}`);
        await mkdir(dirname(resolve(out)), { recursive: true });
        await writeFile(out, body, 'utf8');

        const translated = units.filter((u) => u.target !== undefined).length;
        const keys = units.reduce((n, u) => n + u.keys.length, 0);

        return text(
          [
            `${units.length} ${dedupe ? 'distinct string(s)' : 'string(s)'} for ${locale}` +
              `${dedupe && keys !== units.length ? ` across ${keys} keys` : ''}.`,
            locale === doc.strings.defaultLocale
              ? 'The source language.'
              : `${translated} translated, ${units.length - translated} still to do.`,
            `file:   ${resolve(out)}`,
            `size:   ${(Buffer.byteLength(body, 'utf8') / 1024).toFixed(1)} KB`,
            args.format === 'json'
              ? 'Key for key, as an application needs.'
              : 'Fill in the target column and bring it back with import_strings.',
          ].join('\n'),
        );
      },
    },

    {
      name: 'import_strings',
      config: {
        title: 'Take a translated file back',
        description:
          'Reads a file exported by export_strings — in any of the three formats — and applies ' +
          'it to a locale. A deduplicated file fans each translation back out to every key that ' +
          'holds that text. Keys the project does not have are reported rather than written, ' +
          'because a returned file has usually been through somebody else’s tool. ' +
          'Undoable in one step.',
        inputSchema: {
          file: z.string(),
          locale: z.string(),
          format: z.enum(FORMATS).optional(),
          replace: z.boolean().optional(),
        },
      },
      writes: true,
      run: async (
        args: { file: string; locale: string; format?: StringFormat; replace?: boolean },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        if (!doc.strings.locales[args.locale]) {
          return failure(
            `No locale "${args.locale}". Available: ${Object.keys(doc.strings.locales).join(', ')}. ` +
              'add_locale makes one first.',
          );
        }

        const format = args.format ?? formatOf(args.file);
        if (!format) {
          return failure(
            `Cannot tell the format of ${args.file} from its name. Pass format=json|csv|xliff.`,
          );
        }

        let body: string;
        try {
          body = await readFile(resolve(args.file), 'utf8');
        } catch (e) {
          return failure(`Could not read ${args.file}: ${e instanceof Error ? e.message : e}`);
        }

        const known = new Set(stringUnits(doc).flatMap((u) => u.keys));
        let parsed: ReturnType<typeof parseStrings>;
        try {
          parsed = parseStrings(body, format, known);
        } catch (e) {
          return failure(
            `That file did not read as ${format}: ${e instanceof Error ? e.message : e}`,
          );
        }

        const count = Object.keys(parsed.entries).length;
        if (count === 0) {
          return failure(
            parsed.unknown.length > 0
              ? `Nothing applied: none of its ${parsed.unknown.length} keys exist in ${ctx.id}. ` +
                  'Was it exported from a different project?'
              : 'That file has no filled-in translations.',
          );
        }

        return ctx.store
          .run({
            t: 'strings.set',
            locale: args.locale,
            entries: parsed.entries,
            ...(args.replace !== undefined ? { replace: args.replace } : {}),
          })
          .then((r) =>
            fromResult(
              r,
              [
                `Applied ${count} translation(s) to ${args.locale}.`,
                parsed.unknown.length > 0
                  ? `Ignored ${parsed.unknown.length} key(s) this project does not have: ` +
                    `${parsed.unknown.slice(0, 5).join(', ')}${parsed.unknown.length > 5 ? '…' : ''}`
                  : '',
                args.replace
                  ? 'Replaced the locale outright — anything not in the file is gone.'
                  : 'Merged: keys not in the file kept what they had.',
              ]
                .filter(Boolean)
                .join('\n'),
            ),
          );
      },
    },
  ];
}

/** From the file's own name, so the common case needs no argument. */
function formatOf(file: string): StringFormat | undefined {
  if (/\.json$/i.test(file)) return 'json';
  if (/\.csv$/i.test(file)) return 'csv';
  if (/\.(xlf|xliff)$/i.test(file)) return 'xliff';
  return undefined;
}
