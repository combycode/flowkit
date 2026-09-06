import { describe, expect, test } from 'bun:test';
import {
  importStraiw,
  pageParts,
  parseAttrs,
  parseScreens,
  sheetName,
  tokensUnder,
} from '../src/index';

describe('tokensUnder', () => {
  test('reads custom properties from a block', () => {
    expect(tokensUnder(':root { --bg: #08090d; --text: #f0f0f5; }', ':root')).toEqual({
      '--bg': '#08090d',
      '--text': '#f0f0f5',
    });
  });

  // Regression: the banner comment above a rule was being captured as part of
  // its selector, so `:root` never matched and 65 tokens imported as 7.
  test('is not defeated by a comment above the rule', () => {
    const css = `/* ── brand palette ─────────── */\n:root {\n  --bg: #08090d;\n}`;
    expect(tokensUnder(css, ':root')).toEqual({ '--bg': '#08090d' });
  });

  test('ignores comments between declarations', () => {
    const css = ':root { --a: 1; /* why: because */ --b: 2; }';
    expect(tokensUnder(css, ':root')).toEqual({ '--a': '1', '--b': '2' });
  });

  test('merges repeated blocks in source order, last wins', () => {
    const css = ':root { --a: 1; } :root { --a: 2; --b: 3; }';
    expect(tokensUnder(css, ':root')).toEqual({ '--a': '2', '--b': '3' });
  });

  test('matches one selector out of a list', () => {
    expect(tokensUnder('html, :root, body { --a: 1; }', ':root')).toEqual({ '--a': '1' });
  });

  test('ignores non-custom declarations', () => {
    expect(tokensUnder(':root { color: red; --a: 1; }', ':root')).toEqual({ '--a': '1' });
  });

  test('returns nothing for an absent selector', () => {
    expect(tokensUnder(':root { --a: 1; }', '[data-theme="light"]')).toEqual({});
  });
});

describe('pageParts', () => {
  const page = `<!DOCTYPE html><html><head>
<title>1 · First run</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet">
<link rel="stylesheet" href="../packages/styles/src/tokens.css">
<link rel="stylesheet" href="../packages/styles/src/chat.css">
</head><body class="app" data-spec="closed">
<main>hi</main>
</body></html>`;

  test('extracts the body inner html', () => {
    expect(pageParts(page).body).toBe('<main>hi</main>');
  });

  test('preserves body attributes — they drive layout in this design', () => {
    expect(pageParts(page).bodyAttrs).toBe('class="app" data-spec="closed"');
  });

  test('collects local stylesheets and skips remote ones', () => {
    expect(pageParts(page).sheets).toEqual([
      '../packages/styles/src/tokens.css',
      '../packages/styles/src/chat.css',
    ]);
  });

  test('ignores a preconnect link that is not a stylesheet', () => {
    expect(pageParts(page).sheets.some((h) => h.includes('preconnect'))).toBe(false);
  });

  test('reads the title', () => {
    expect(pageParts(page).title).toBe('1 · First run');
  });

  test('sheetName reduces an href to its kit identity', () => {
    expect(sheetName('../packages/styles/src/chat.css')).toBe('chat');
    expect(sheetName('chat.css')).toBe('chat');
  });
});

describe('importStraiw', () => {
  const css = {
    tokens: ':root { --bg: #000; --text: #fff; } [data-theme="light"] { --bg: #fff; }',
    base: 'body { margin: 0; }',
    scrollbars: '* { scrollbar-width: thin; }',
    chat: '.chat { display: flex; }',
    unused: '.nope { color: red; }',
  };
  const screens = [
    {
      name: '01-first-run',
      html: `<html><head><title>First run</title>
<link rel="stylesheet" href="../s/tokens.css">
<link rel="stylesheet" href="../s/base.css">
<link rel="stylesheet" href="../s/chat.css">
</head><body class="app"><main>hi</main></body></html>`,
      group: 'briefing',
    },
  ];
  const doc = importStraiw({
    projectName: 'Test',
    screens,
    css,
    groups: [{ id: 'briefing', label: 'Briefing' }],
    now: () => '2026-01-01T00:00:00.000Z',
    newId: () => 'fixed-id',
  });

  test('imports each screen as an opaque screen item', () => {
    const item = doc.items['01-first-run'];
    expect(item?.tier).toBe('screen');
    expect(item?.html).toContain('>hi</main>');
    expect(item?.html).not.toContain('<x-');
  });

  // Regression: these were briefly wrapped in a div, which stopped
  // `body[data-spec='closed'] .spec { display: none }` matching — so the brief
  // panel rendered OPEN on every screen that should have had it shut.
  test('keeps body attributes as attributes of the body, not a wrapper', () => {
    expect(doc.items['01-first-run']?.rootAttrs).toEqual({ class: 'app' });
    expect(doc.items['01-first-run']?.html).not.toContain('<div class="app">');
    // The markup is the body's own, plus the data-t stamps extraction adds.
    expect(doc.items['01-first-run']?.html).toBe('<main data-t="01-first-run.hi">hi</main>');
  });

  test('extracts the default locale from the markup it stamped', () => {
    expect(doc.strings.defaultLocale).toBe('en');
    expect(doc.strings.locales.en?.entries['01-first-run.hi']).toBe('hi');
  });

  test('merges an overlay locale alongside the extracted default', () => {
    const withRu = importStraiw({
      projectName: 'Test',
      screens,
      css,
      locales: { ru: { label: 'Русский', entries: { '01-first-run.hi': 'привет' } } },
      now: () => '',
      newId: () => 'x',
    });
    expect(Object.keys(withRu.strings.locales).sort()).toEqual(['en', 'ru']);
    expect(withRu.strings.locales.ru?.entries['01-first-run.hi']).toBe('привет');
  });

  test('attributes per-screen sheets to the item, not tokens or base', () => {
    expect(doc.items['01-first-run']?.sheets).toEqual(['chat']);
  });

  test('puts global sheets in kit.base', () => {
    expect(doc.kit.base).toContain('margin: 0');
  });

  // scrollbars.css is linked AFTER chat.css in the source, so it is a normal
  // sheet rather than a base one — treating it as base moved it earlier in the
  // cascade, which is a fidelity change however small.
  test('stores per-screen sheets in source order', () => {
    expect(doc.items['01-first-run']?.sheets).toEqual(['chat']);
    expect(Object.keys(doc.kit.sheets)).toEqual(['chat']);
  });

  // The responsive type scale lives in @media blocks and cannot be expressed
  // by a flat token map, so it is carried through as CSS. Flattening it made
  // every screen render at the 2200px-breakpoint font size.
  test('carries media-scoped token overrides through as css', () => {
    const withScale = importStraiw({
      projectName: 'T',
      screens,
      css: { ...css, tokens: `${css.tokens} @media (min-width: 1200px) { :root { --bg: #123; } }` },
      now: () => '',
      newId: () => 'x',
    });
    expect(withScale.kit.base).toContain('@media (min-width: 1200px)');
    // …and does NOT let the media value leak into the base theme.
    expect(withScale.kit.themes.dark?.tokens['--bg']).toBe('#000');
  });

  // The light theme selector is `:root[data-theme='light']` — single quotes.
  // Matching the literal string `[data-theme="light"]` found nothing, so light
  // was silently identical to dark.
  test('finds the light theme however the source quotes the selector', () => {
    const single = importStraiw({
      projectName: 'T',
      screens,
      css: { ...css, tokens: `:root { --bg: #000; } :root[data-theme='light'] { --bg: #fff; }` },
      now: () => '',
      newId: () => 'x',
    });
    expect(single.kit.themes.light?.tokens['--bg']).toBe('#fff');
    expect(single.kit.themes.dark?.tokens['--bg']).toBe('#000');
  });

  test('builds a complete token map per theme, not a diff', () => {
    // light overrides only --bg, but must still carry --text.
    expect(doc.kit.themes.light?.tokens).toEqual({ '--bg': '#fff', '--text': '#fff' });
    expect(doc.kit.themes.dark?.tokens).toEqual({ '--bg': '#000', '--text': '#fff' });
  });

  test('every theme defines the same token set', () => {
    const sets = Object.values(doc.kit.themes).map((t) => Object.keys(t.tokens).sort().join(','));
    expect(new Set(sets).size).toBe(1);
  });

  test('creates one node per screen, tagged with its group', () => {
    expect(doc.flow.nodes['01-first-run']?.groups).toEqual(['briefing']);
    expect(doc.flow.nodes['01-first-run']?.screen).toBe('01-first-run');
  });

  test('is deterministic when the clock and id are injected', () => {
    const again = importStraiw({
      projectName: 'Test',
      screens,
      css,
      groups: [{ id: 'briefing', label: 'Briefing' }],
      now: () => '2026-01-01T00:00:00.000Z',
      newId: () => 'fixed-id',
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(doc));
  });
});

describe('parseAttrs', () => {
  test('reads the attributes that drive screen state', () => {
    expect(parseAttrs('class="app" data-spec="closed" data-spec-desktop="docked"')).toEqual({
      class: 'app',
      'data-spec': 'closed',
      'data-spec-desktop': 'docked',
    });
  });

  test('handles single quotes and valueless attributes', () => {
    expect(parseAttrs("class='ops' hidden")).toEqual({ class: 'ops', hidden: '' });
  });

  test('is empty for an empty string', () => {
    expect(parseAttrs('')).toEqual({});
  });
});

describe('parseScreens', () => {
  const index = `
  var SCREENS = [
    { f: '01-first-run', flow: 'briefing', n: 1,  t: 'First run', c: 'Brief pill present.' },
    { f: '05-files',     flow: 'briefing', n: 7,  t: 'Files &amp; links', c: 'The <b>library</b>.' },
  ];`;

  test('reads file, flow, order, title and caption', () => {
    expect(parseScreens(index)).toEqual([
      {
        file: '01-first-run',
        group: 'briefing',
        order: 1,
        title: 'First run',
        caption: 'Brief pill present.',
      },
      {
        file: '05-files',
        group: 'briefing',
        order: 7,
        title: 'Files & links',
        caption: 'The library.',
      },
    ]);
  });

  test('degrades to nothing rather than guessing when the array is absent', () => {
    expect(parseScreens('<html>no metadata here</html>')).toEqual([]);
  });
});
