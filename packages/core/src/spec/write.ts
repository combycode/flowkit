/* The design as something somebody can build from.
 *
 * Not a picture gallery and not a dump of the document: a specification is what
 * a developer opens instead of asking the designer forty questions, and the
 * forty questions are always the same ones. What is this screen for. What is
 * actually written on it. What puts it in each state. What leads here, what
 * leads away, and on what condition. What is it built out of. What did nobody
 * decide.
 *
 * Written against the GRAPH rather than against the screens. Today every node
 * is a screen; when a node can also be a data model or an endpoint, the shape
 * of this file does not change — only what a section is about does. Writing it
 * against `doc.items` would have meant rewriting it on that day.
 *
 * Pure: it takes the document and the names of pictures somebody else rendered,
 * and returns text. Nothing here touches a disk or a browser.
 */

import { expand } from '../render/expand';
import type { FlowNode, NodeId, ProjectDoc } from '../types/project';

export interface SpecOptions {
  /** Only these flows, in this order. Defaults to every flow, then the
   *  screens belonging to none. */
  groups?: readonly string[];
  /** Only these screens. Defaults to every screen on the canvas.
   *
   *  Whoever renders the pictures decides what the spec covers — kit sheets
   *  left out, a size that some screens are not designed at — and the prose has
   *  to cover exactly that. Walking every node instead put five sections with
   *  no picture under a heading that promised 71 screens and showed 66. */
  screens?: readonly string[];
  /** Where a screen's picture is, by node id. Omit for a spec with no images. */
  images?: Readonly<Record<NodeId, string>>;
  /** Which language the pictures were taken in. Defaults to the project's own,
   *  and is only worth saying when it is not. */
  locale?: string;
}

export function writeSpec(doc: ProjectDoc, options: SpecOptions = {}): string {
  const locale = options.locale ?? doc.strings.defaultLocale;
  const sections = flowSections(doc, options.groups, options.screens);
  const out: string[] = [];

  out.push(`# ${doc.name}`, '');
  out.push(...summary(doc, locale, sections), '');

  if (sections.length > 1) {
    out.push('## Contents', '');
    for (const { label, nodes } of sections) {
      out.push(`- [${label}](#${anchor(label)}) — ${count(nodes.length, 'screen')}`);
    }
    out.push('');
  }

  for (const section of sections) {
    out.push(`## ${section.label}`, '');
    if (section.note) out.push(section.note, '');

    for (const [index, [id, node]] of section.nodes.entries()) {
      out.push(...screenSection(doc, id, node, index + 1, options), '');
    }
  }

  out.push(...systemSection(doc));
  out.push(...gapsSection(doc, sections));

  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/* ── the header ─────────────────────────────────────────────────────────── */

/* Counted from the sections rather than from the document: the header is the
 * first thing anybody checks a specification against, and a number describing
 * screens that are not in it is worse than no number. */
function summary(doc: ProjectDoc, locale: string, sections: readonly Section[]): string[] {
  const screens = sections.reduce((n, s) => n + s.nodes.length, 0);
  // Generated parts are the kit's own scaffolding — the registry table below
  // leaves them out, so the count above it has to as well.
  const parts = Object.values(doc.items).filter(
    (i) => i.tier !== 'screen' && i.generated === undefined,
  ).length;
  const mockups = new Set(
    sections
      .flatMap((s) => s.nodes)
      .map(([, node]) => node.screen)
      .filter((name) => {
        const item = doc.items[name];
        return item?.image !== undefined && item.html.trim() === '';
      }),
  ).size;

  const lines = [
    `${count(screens, 'screen')} in ${count(sections.length, 'flow')}, ` +
      `built from ${count(parts, 'part')}.`,
    '',
    `- **Sizes** — ${doc.viewports.map((v) => `${v.label} ${v.width}×${v.height}`).join(', ')}`,
    `- **Themes** — ${Object.values(doc.kit.themes)
      .map((t) => t.label)
      .join(', ')}`,
    `- **Languages** — ${Object.values(doc.strings.locales)
      .map((l) => l.label)
      .join(', ')}`,
  ];
  if (locale !== doc.strings.defaultLocale) lines.push(`- **Pictures in** — ${locale}`);
  if (mockups > 0) {
    lines.push(
      '',
      `> ${count(mockups, 'screen')} ${mockups === 1 ? 'is' : 'are'} still a mockup — ` +
        'a picture standing in until somebody builds it. Those sections describe intent ' +
        'rather than an implementation.',
    );
  }
  return lines;
}

/* ── a flow ─────────────────────────────────────────────────────────────── */

interface Section {
  id: string | undefined;
  label: string;
  note?: string;
  nodes: [NodeId, FlowNode][];
}

function flowSections(
  doc: ProjectDoc,
  only?: readonly string[],
  screens?: readonly string[],
): Section[] {
  const covered = screens ? new Set(screens) : undefined;
  const entries = Object.entries(doc.flow.nodes).filter(
    ([, n]) => !covered || covered.has(n.screen),
  );
  const wanted = doc.flow.groups.filter((g) => !only || only.includes(g.id));

  const sections: Section[] = wanted.map((group) => ({
    id: group.id,
    label: group.label,
    ...(group.note !== undefined ? { note: group.note } : {}),
    nodes: entries
      .filter(([, n]) => (n.groups ?? []).includes(group.id))
      .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0)),
  }));

  if (!only) {
    // A screen in no flow is still part of the product, and leaving it out of
    // the spec is how it gets built by nobody.
    const loose = entries.filter(([, n]) => (n.groups ?? []).length === 0);
    if (loose.length > 0) {
      sections.push({ id: undefined, label: 'Not in any flow', nodes: loose });
    }
  }

  return sections.filter((s) => s.nodes.length > 0);
}

/* ── one screen ─────────────────────────────────────────────────────────── */

function screenSection(
  doc: ProjectDoc,
  id: NodeId,
  node: FlowNode,
  position: number,
  options: SpecOptions,
): string[] {
  const item = doc.items[node.screen];
  const title = node.title ?? node.screen;
  const out = [`### ${position}. ${title}`, ''];

  out.push(`\`${node.screen}\``);
  if (node.description) out.push('', node.description);
  out.push('');

  const picture = options.images?.[id];
  if (picture) out.push(`![${escapeMd(title)}](${picture})`, '');

  if (item?.image !== undefined && item.html.trim() === '') {
    out.push('> Still a mockup: this screen is a picture, not built markup.', '');
  }

  const facts = [...factLines(doc, node, item)];
  if (facts.length > 0) out.push(...facts, '');

  /* The copy used to be quoted here, every keyed string on the screen. It read
   * as noise: a screen is two hundred keys once its components are expanded,
   * most of them a word on a chip or half a counter, and the picture directly
   * above already says what it says. The strings export is where that belongs —
   * one file, deduplicated, in a shape a translator can work through. */

  const built = builtFrom(doc, node.screen);
  if (built.length > 0) {
    out.push(`**Built from** — ${built.map((n) => `\`${n}\``).join(', ')}`, '');
  }

  out.push(...connections(doc, id));
  return out;
}

function* factLines(
  doc: ProjectDoc,
  node: FlowNode,
  item: ProjectDoc['items'][string] | undefined,
): Generator<string> {
  const viewport = node.viewport ?? item?.viewport;
  if (viewport) yield `- **Designed at** — ${viewport}`;

  /* Meta is quoted as written, because it is the one part of the document
   * nothing here interprets — roles, endpoints, a rule, a ticket. Rewording it
   * would be inventing. */
  for (const [key, value] of Object.entries({ ...item?.meta, ...node.meta })) {
    yield `- **${escapeMd(key)}** — ${inline(value)}`;
  }
}

/** What leads here and what leads away — the half of a design that pictures
 *  cannot show. */
function connections(doc: ProjectDoc, id: NodeId): string[] {
  const name = (other: NodeId) => doc.flow.nodes[other]?.title ?? other;
  const going = Object.values(doc.flow.edges).filter((e) => e.from === id);
  const coming = Object.values(doc.flow.edges).filter((e) => e.to === id);
  const out: string[] = [];

  if (coming.length > 0) {
    out.push(
      `**Reached from** — ${coming
        .map((e) => `${name(e.from)}${e.label ? ` (${e.label})` : ''}`)
        .join(', ')}`,
      '',
    );
  }
  if (going.length > 0) {
    out.push('**Leads to**', '');
    for (const edge of going) {
      const why = edge.label ? `**${escapeMd(edge.label)}** → ` : '';
      const guessed = edge.origin === 'auto' ? ' _(assumed by the importer, not decided)_' : '';
      out.push(`- ${why}${name(edge.to)}${guessed}`);
    }
    out.push('');
  } else {
    out.push('**Leads to** — nothing. This is where the journey stops.', '');
  }
  return out;
}

/* ── the design system ──────────────────────────────────────────────────── */

/** The tokens first, then the typefaces, then the parts built out of them.
 *
 *  In that order on purpose: a developer cannot build the first component
 *  without the colour it is painted in, and the values ARE the design — a part
 *  can be rebuilt from its picture, a palette cannot be guessed from one. */
function systemSection(doc: ProjectDoc): string[] {
  const body = [...tokenTables(doc), ...fontList(doc), ...partsTable(doc)];
  if (body.length === 0) return [];

  return [
    '## The design system',
    '',
    'What every screen above is made of. Build these first: a value or a part that ' +
      'behaves differently here behaves differently everywhere.',
    '',
    ...body,
  ];
}

/* Grouped by what the value IS, not by what it is named. Naming conventions
 * belong to whoever wrote the design — `--fs-body` here, `--text-size-body`
 * somewhere else — and a specification that only recognised one of them would
 * quietly drop the palette of every project that spells it differently. */
type TokenKind = 'colour' | 'size' | 'text' | 'alias' | 'other';

const KIND_ORDER: readonly TokenKind[] = ['colour', 'size', 'text', 'alias', 'other'];

const KIND_TITLE: Readonly<Record<TokenKind, string>> = {
  colour: 'Colour',
  size: 'Size and spacing',
  text: 'Type',
  alias: 'Named for a purpose',
  other: 'Everything else',
};

const KIND_NOTE: Readonly<Record<TokenKind, string>> = {
  colour: 'Every colour in the product. Nothing outside this table should appear in a stylesheet.',
  size: 'The steps a distance is allowed to take — spacing, radius, and the widths things stop at.',
  text: 'Typefaces, sizes and line heights.',
  alias:
    'A token pointing at another one. The indirection IS the decision: change what a panel ' +
    'is painted with here and every panel follows.',
  other: 'Shadows, transitions, and whatever else the design keeps in one place.',
};

function kindOf(value: string): TokenKind {
  const v = value.trim();
  if (/^var\(/.test(v)) return 'alias';
  if (/^(#|rgba?\(|hsla?\(|oklch\(|color-mix\()/.test(v)) return 'colour';
  if (/(sans-serif|serif|monospace|system-ui|cursive|ui-[a-z]+|['"])/.test(v)) return 'text';
  if (/^-?[\d.]+(px|rem|em|ch|%|vh|vw|dvh|dvw|pt)$/.test(v)) return 'size';
  if (/^-?[\d.]+$/.test(v)) return 'text'; // a bare number is a line height
  return 'other';
}

function tokenTables(doc: ProjectDoc): string[] {
  const themes = Object.entries(doc.kit.themes);
  if (themes.length === 0) return [];

  /* Union rather than the default theme's keys alone: a token defined in one
   * theme and not another is exactly the kind of hole worth seeing. */
  const names: string[] = [];
  for (const [, theme] of themes) {
    for (const name of Object.keys(theme.tokens)) if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) return [];

  const first = themes[0]?.[1].tokens ?? {};
  const grouped = new Map<TokenKind, string[]>();
  for (const name of names) {
    const kind = kindOf(
      first[name] ?? themes.find(([, t]) => t.tokens[name])?.[1].tokens[name] ?? '',
    );
    const list = grouped.get(kind);
    if (list) list.push(name);
    else grouped.set(kind, [name]);
  }

  const head = `| Token | ${themes.map(([, t]) => escapeMd(t.label)).join(' | ')} |`;
  const rule = `| --- | ${themes.map(() => '---').join(' | ')} |`;

  const out: string[] = [];
  for (const kind of KIND_ORDER) {
    const list = grouped.get(kind);
    if (!list || list.length === 0) continue;

    out.push(`### ${KIND_TITLE[kind]}`, '', KIND_NOTE[kind], '', head, rule);
    for (const name of list) {
      const values = themes.map(([, theme]) => {
        const value = theme.tokens[name];
        return value === undefined ? '—' : `\`${value}\``;
      });
      out.push(`| \`${name}\` | ${values.join(' | ')} |`);
    }
    out.push('');
  }
  return out;
}

function fontList(doc: ProjectDoc): string[] {
  if (doc.kit.fonts.length === 0) return [];

  const out = [
    '### Typefaces',
    '',
    'Carried in the document, so nothing here depends on a ' + 'network at build time.',
    '',
  ];
  const seen = new Set<string>();
  for (const font of doc.kit.fonts) {
    const weights = doc.kit.fonts
      .filter((f) => f.family === font.family && f.style === font.style)
      .map((f) => f.weight);
    const key = `${font.family}|${font.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      `- **${escapeMd(font.family)}** — ${[...new Set(weights)].join(', ')}` +
        `${font.style !== 'normal' ? `, ${font.style}` : ''}`,
    );
  }
  out.push('');
  return out;
}

function partsTable(doc: ProjectDoc): string[] {
  const parts = Object.entries(doc.items)
    .filter(([, item]) => item.tier !== 'screen' && item.generated === undefined)
    .sort(([, a], [, b]) => a.tier.localeCompare(b.tier) || 0);
  if (parts.length === 0) return [];

  /* A part's meta is where the thing it stands for gets written down — which
   * enum a status maps to, which endpoint fills a list. It has nowhere else to
   * appear: only screens get a section of their own, so without a column here
   * the one note somebody bothered to leave is dropped from the handover. */
  const noted = parts.some(([, item]) => Object.keys(item.meta ?? {}).length > 0);

  const out = [
    '### Parts',
    '',
    'What the screens are assembled from, simplest first.',
    '',
    `| Part | Kind | States | What it is |${noted ? ' Notes |' : ''}`,
    `| --- | --- | --- | --- |${noted ? ' --- |' : ''}`,
  ];

  for (const [name, item] of parts) {
    const states = Object.keys(item.variants ?? {});
    const notes = Object.entries(item.meta ?? {})
      .map(([key, value]) => `**${escapeMd(key)}** ${inline(value)}`)
      .join('; ');
    out.push(
      `| \`${name}\` | ${item.tier} | ${states.length > 0 ? states.join(', ') : '—'} | ` +
        `${escapeMd(item.description ?? '')} |${noted ? ` ${notes} |` : ''}`,
    );
  }
  out.push('');
  return out;
}

/* ── what nobody decided ────────────────────────────────────────────────── */

function gapsSection(doc: ProjectDoc, sections: readonly Section[]): string[] {
  const inSpec = new Set(sections.flatMap((s) => s.nodes.map(([id]) => id)));
  const gaps: string[] = [];

  const all = Object.values(doc.flow.edges);

  /* The COUNT is only what this document covers. Counting every edge in the
   * project put "53 connections were guessed" at the end of a specification for
   * one flow of twelve screens — a number the reader cannot check against
   * anything in front of them, in the section whose whole job is to be
   * trustworthy. */
  const covered = all.filter((e) => inSpec.has(e.from) && inSpec.has(e.to));
  const assumed = covered.filter((e) => e.origin === 'auto').length;

  /* A dead end is not. Scoping these the same way called a screen a dead end
   * two paragraphs after its own section said where it leads — the journey
   * continued, just into a flow this document does not cover. Whether anything
   * leads away is a fact about the graph; only WHICH of them to name here is a
   * question of scope. */
  const deadEnds = [...inSpec].filter((id) => !all.some((e) => e.from === id));
  const unreachable = [...inSpec].filter((id) => !all.some((e) => e.to === id));

  const label = (id: NodeId) => doc.flow.nodes[id]?.title ?? id;

  if (deadEnds.length > 0) {
    gaps.push(
      `- **Nothing leads away from** ${deadEnds.map(label).join(', ')}. Either the journey ` +
        'ends there, or the next step was never drawn.',
    );
  }
  if (unreachable.length > 0) {
    gaps.push(
      `- **Nothing leads to** ${unreachable.map(label).join(', ')}. Either it is where ` +
        'somebody starts, or the way in is missing.',
    );
  }
  if (assumed > 0) {
    gaps.push(
      `- **${count(assumed, 'connection')}** ${assumed === 1 ? 'was' : 'were'} guessed by the ` +
        'importer from screen order rather than decided. Treat them as questions.',
    );
  }

  if (gaps.length === 0) return [];
  return [
    '## What this does not answer',
    '',
    'Listed rather than hidden: somebody building from this will fill these in either way, ' +
      'and it is cheaper to know where that happened.',
    '',
    ...gaps,
    '',
  ];
}

/* ── reading the document ───────────────────────────────────────────────── */

/** The registry items a screen composes, in the order they appear. */
function builtFrom(doc: ProjectDoc, name: string): string[] {
  const item = doc.items[name];
  if (!item || !item.html.includes('<x-')) return [];
  return [...new Set(expand(doc, item.html, item).used)];
}

/* ── formatting ─────────────────────────────────────────────────────────── */

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A meta value on one line. Objects and arrays as JSON, because rewording
 *  them would be inventing what somebody wrote down. */
const inline = (value: unknown): string =>
  typeof value === 'string' ? escapeMd(value) : `\`${JSON.stringify(value)}\``;

const escapeMd = (s: string): string => s.replace(/([|*_`[\]])/g, '\\$1');

const anchor = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
