/* Strings, out to a file and back.
 *
 * Two different jobs wear the same name, and conflating them is how a
 * translation round trip goes wrong:
 *
 *   IMPLEMENTATION wants one language, every key, key for key — an `en.json`
 *   an application loads. Deduplicating would be nonsense: the code asks for
 *   `04-ready.title`, and it has to be there.
 *
 *   TRANSLATION wants source beside target, with enough context to choose a
 *   word, and it wants each distinct SENTENCE once. STRAIW holds 2211 keys and
 *   927 distinct texts: "Brief" is written once and lands on twenty-two keys.
 *   Sending 2211 rows means paying to translate the same word twenty-two times
 *   and risking twenty-two different answers.
 *
 * So JSON is always key-for-key, and CSV and XLIFF deduplicate by default.
 *
 * THE SOURCE TEXT COMES FROM THE MARKUP, not from the default locale's
 * entries. For the default language the markup IS the text — `localize` does
 * not substitute anything — so an entry that has drifted from the screen is a
 * stale copy, and sending translators a sentence that is no longer on screen
 * is the one failure this must not have.
 */

import { scanText } from '../html/scan';
import { rendered } from '../render/rendered';
import type { LocaleId, ProjectDoc } from '../types/project';

export type StringFormat = 'json' | 'csv' | 'xliff';

/** Where a string appears: which screen, and what it is inside it. */
export interface StringUse {
  item: string;
  tag: string;
  classes?: string;
}

export interface StringUnit {
  /** One key, or every key holding this text when deduplicated. */
  keys: string[];
  /** The default-language text, read from the markup. */
  source: string;
  /** What the target locale says today, if anything. */
  target?: string;
  uses: StringUse[];
}

export interface UnitOptions {
  /** The locale being produced. Omit for the source language alone. */
  locale?: LocaleId;
  /** One unit per distinct source text rather than per key. */
  dedupe?: boolean;
}

/* ── reading the document ───────────────────────────────────────────────── */

/** Every keyed string in the project, with where it is used. */
export function stringUnits(doc: ProjectDoc, options: UnitOptions = {}): StringUnit[] {
  const target = options.locale ? (doc.strings.locales[options.locale]?.entries ?? {}) : {};

  const source = new Map<string, string>();
  const uses = new Map<string, StringUse[]>();

  for (const [name, item] of Object.entries(doc.items)) {
    // Generated pages describe the design system to whoever is building it.
    // Nobody should be paying to have them translated.
    if (item.generated) continue;

    // As it ships: a component's call site holds the key in one fill and the
    // text in another, and only composition puts them back together.
    const html = rendered(doc, item);

    for (const el of scanText(html)) {
      const keys = attrOf(html, el.openStart, el.openEnd, 'data-t')?.split('|');
      if (!keys) continue;
      const classes = attrOf(html, el.openStart, el.openEnd, 'class');

      el.texts.forEach((span, i) => {
        const key = keys[i];
        if (key === undefined) return;
        const text = html.slice(span.start, span.end).trim();
        if (text === '') return;

        if (!source.has(key)) source.set(key, decodeEntities(text));
        uses.set(key, [
          ...(uses.get(key) ?? []),
          { item: name, tag: el.tag, ...(classes ? { classes } : {}) },
        ]);
      });
    }
  }

  // A key whose element has since been deleted still has a translation worth
  // keeping; fall back to the recorded default so it is not silently dropped.
  const fallback = doc.strings.locales[doc.strings.defaultLocale]?.entries ?? {};
  for (const [key, text] of Object.entries(fallback)) {
    if (!source.has(key)) source.set(key, text);
  }

  const units: StringUnit[] = [...source.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, text]) => ({
      keys: [key],
      source: text,
      ...(target[key] !== undefined ? { target: target[key] } : {}),
      uses: uses.get(key) ?? [],
    }));

  return options.dedupe ? dedupe(units) : units;
}

/** One unit per distinct source text, carrying every key that holds it. */
function dedupe(units: readonly StringUnit[]): StringUnit[] {
  const byText = new Map<string, StringUnit>();

  for (const unit of units) {
    const found = byText.get(unit.source);
    if (!found) {
      byText.set(unit.source, { ...unit, keys: [...unit.keys], uses: [...unit.uses] });
      continue;
    }
    found.keys.push(...unit.keys);
    found.uses.push(...unit.uses);
    // Any existing translation is worth showing; if two keys disagree, the
    // first wins and the difference is visible in the file.
    if (found.target === undefined && unit.target !== undefined) found.target = unit.target;
  }

  return [...byText.values()];
}

/* ── writing ────────────────────────────────────────────────────────────── */

export interface WriteOptions {
  format: StringFormat;
  /** The language the file is FOR. */
  locale: LocaleId;
  /** The language the source text is in. */
  sourceLocale: LocaleId;
}

export function writeStrings(units: readonly StringUnit[], options: WriteOptions): string {
  switch (options.format) {
    case 'json':
      return toJson(units, options.locale === options.sourceLocale);
    case 'csv':
      return toCsv(units);
    case 'xliff':
      return toXliff(units, options);
  }
}

/** Flat key to value — what an application loads.
 *
 *  A key with no translation is OMITTED rather than filled with the source:
 *  that is what the renderer does, so a runtime that falls back per key
 *  behaves the same way as the canvas. */
function toJson(units: readonly StringUnit[], isSource: boolean): string {
  const out: Record<string, string> = {};
  for (const unit of units) {
    const value = isSource ? unit.source : unit.target;
    if (value === undefined) continue;
    for (const key of unit.keys) out[key] = value;
  }
  return `${JSON.stringify(sorted(out), null, 2)}\n`;
}

function toCsv(units: readonly StringUnit[]): string {
  const rows = [
    ['key', 'source', 'target', 'screens', 'element'],
    ...units.map((u) => [
      u.keys.join(' '),
      u.source,
      u.target ?? '',
      [...new Set(u.uses.map((p) => p.item))].join(' '),
      describeUse(u),
    ]),
  ];
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}

function toXliff(units: readonly StringUnit[], options: WriteOptions): string {
  const body = units
    .map((unit, i) => {
      const notes = [
        ...[...new Set(unit.uses.map((p) => p.item))]
          .slice(0, 8)
          .map((item) => `        <note category="screen">${xml(item)}</note>`),
        describeUse(unit) === ''
          ? ''
          : `        <note category="element">${xml(describeUse(unit))}</note>`,
        // Deduplicated units cover several keys; the file has to say which, or
        // an import cannot put the translation back where it came from.
        unit.keys.length > 1
          ? `        <note category="keys">${xml(unit.keys.join(' '))}</note>`
          : '',
      ].filter(Boolean);

      return [
        `    <unit id="${xml(unit.keys[0] ?? `unit-${i}`)}">`,
        notes.length > 0 ? `      <notes>\n${notes.join('\n')}\n      </notes>` : '',
        '      <segment>',
        `        <source>${xml(unit.source)}</source>`,
        `        <target>${xml(unit.target ?? '')}</target>`,
        '      </segment>',
        '    </unit>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${xml(
    options.sourceLocale,
  )}" trgLang="${xml(options.locale)}">
  <file id="flowkit">
${body}
  </file>
</xliff>
`;
}

/** What the string IS, wherever it appears.
 *
 *  A translator choosing a word needs this: a button reads differently from a
 *  heading, and in most languages differently enough to change the wording.
 *
 *  EVERY distinct form, not the first one. A deduplicated unit covers several
 *  places — "Brief" is a button on one screen and a span on another — and
 *  naming only one of them tells the translator something that is true in one
 *  place and misleading in the rest. */
function describeUse(unit: StringUnit): string {
  const forms = new Set(
    unit.uses.map((use) => `${use.tag}${use.classes ? `.${use.classes.split(/\s+/)[0]}` : ''}`),
  );
  return [...forms].sort().slice(0, 4).join(', ');
}

/* ── reading back ───────────────────────────────────────────────────────── */

export interface ParsedStrings {
  /** Key to translated text. Deduplicated files are already fanned out. */
  entries: Record<string, string>;
  /** Rows that named a key the project does not have. */
  unknown: string[];
}

/** Read a file a translator has filled in.
 *
 *  `known` is the project's key set: a returned file often carries edits,
 *  reorderings and occasionally invented rows, and a key nobody recognises
 *  should be reported rather than written into the document. */
export function parseStrings(
  text: string,
  format: StringFormat,
  known: ReadonlySet<string>,
): ParsedStrings {
  const raw =
    format === 'json' ? fromJson(text) : format === 'csv' ? fromCsv(text) : fromXliff(text);

  const entries: Record<string, string> = {};
  const unknown: string[] = [];

  for (const [keys, value] of raw) {
    if (value === '') continue;
    for (const key of keys) {
      if (known.has(key)) entries[key] = value;
      else unknown.push(key);
    }
  }
  return { entries, unknown: [...new Set(unknown)] };
}

type Row = [keys: string[], value: string];

function fromJson(text: string): Row[] {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Object.entries(parsed)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => [[k], v as string]);
}

function fromCsv(text: string): Row[] {
  const rows = csvRows(text);
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const keyAt = header.indexOf('key');
  const targetAt = header.indexOf('target');
  if (keyAt === -1 || targetAt === -1) {
    throw new Error('That CSV has no "key" and "target" columns.');
  }
  return rows
    .filter((r) => (r[keyAt] ?? '') !== '')
    .map((r) => [(r[keyAt] ?? '').split(/\s+/).filter(Boolean), r[targetAt] ?? '']);
}

/* An agency's tool rewrites the file: it adds segments, splits units, and
   moves the notes about. So this reads unit by unit and takes every target
   inside one, rather than assuming the shape we wrote. */
function fromXliff(text: string): Row[] {
  const out: Row[] = [];

  for (const unit of text.matchAll(/<unit\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/unit>/g)) {
    const id = unxml(unit[1] ?? '');
    const body = unit[2] ?? '';

    // A deduplicated unit lists its keys in a note; otherwise the id is one.
    const listed = /<note[^>]*category="keys"[^>]*>([\s\S]*?)<\/note>/.exec(body)?.[1];
    const keys = listed ? unxml(listed).split(/\s+/).filter(Boolean) : [id];

    const targets = [...body.matchAll(/<target\b[^>]*>([\s\S]*?)<\/target>/g)].map((m) =>
      unxml(m[1] ?? ''),
    );
    const value = targets.join('').trim();
    if (value !== '') out.push([keys, value]);
  }

  return out;
}

/* ── text plumbing ──────────────────────────────────────────────────────── */

const sorted = (o: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const csvField = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A quoted field can contain commas, newlines and doubled quotes. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ''));
}

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unxml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Markup carries entities; a translator's file should carry the character. */
const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** An attribute's value from an element's open tag. */
function attrOf(
  html: string,
  openStart: number,
  openEnd: number,
  name: string,
): string | undefined {
  const tag = html.slice(openStart, openEnd);
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match?.[1];
}
