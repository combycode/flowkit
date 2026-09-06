import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc, RenderContext } from '../src/index';
import { composeDocument, composeStylesheet, themeCss } from '../src/index';

const authItem: Item = {
  tier: 'screen',
  html: '<main class="chat">hi</main>',
  css: '.auth { padding: 8px; }',
  sheets: ['chat'],
  props: {},
  fixtures: { default: { values: {} } },
  description: 'Sign in',
};

const doc: ProjectDoc = {
  schema: 1,
  id: 't',
  name: 'Test',
  createdAt: '',
  updatedAt: '',
  kit: {
    preset: 'none',
    base: 'body { margin: 0; }',
    sheets: { chat: '.chat { display: flex; }', other: '.other { color: red; }' },
    themes: {
      dark: { label: 'Dark', tokens: { '--bg': '#000' } },
      light: { label: 'Light', tokens: { '--bg': '#fff' } },
    },
    defaultTheme: 'dark',
    fonts: [],
  },
  items: { auth: authItem },
  flow: { nodes: {}, edges: {}, groups: [] },
  strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
  assets: {},
  viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
};

const ctx: RenderContext = { theme: 'dark', locale: 'en', viewport: 'mobile' };

describe('themeCss', () => {
  test('emits exactly one :root block for the theme being rendered', () => {
    const css = themeCss({ label: 'D', tokens: { '--bg': '#000', '--fg': '#fff' } });
    expect(css).toContain('--bg: #000;');
    expect(css).toContain('--fg: #fff;');
    // No conditional wrapper: a token defined only inside a media query or a
    // [data-theme] block is how pages end up half-themed.
    expect(css).not.toContain('@media');
    expect(css).not.toContain('data-theme');
  });
});

describe('composeDocument', () => {
  const out = composeDocument({ doc, item: 'auth', ctx });

  test('produces a complete document', () => {
    expect(out.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out.html).toContain('</html>');
  });

  test('is self-contained — srcdoc has no base URL, so any relative URL dies silently', () => {
    expect(out.html).not.toMatch(/(?:href|src)\s*=\s*["']\.{0,2}\//);
    expect(out.html).not.toContain('<link');
  });

  test('inlines the active theme only', () => {
    expect(out.html).toContain('--bg: #000');
    expect(out.html).not.toContain('#fff');
  });

  test('switching theme re-composes rather than toggling a selector', () => {
    const light = composeDocument({ doc, item: 'auth', ctx: { ...ctx, theme: 'light' } });
    expect(light.html).toContain('--bg: #fff');
    expect(light.html).not.toContain('--bg: #000');
  });

  test('includes base, the item sheets, and the item css', () => {
    expect(out.html).toContain('margin: 0');
    expect(out.html).toContain('.chat { display: flex; }');
    expect(out.html).toContain('.auth { padding: 8px; }');
  });

  test('excludes sheets the item did not ask for', () => {
    expect(out.html).not.toContain('.other');
  });

  test('carries the body markup verbatim', () => {
    expect(out.html).toContain('<main class="chat">hi</main>');
  });

  test('reports what it used, so the canvas knows what to re-render', () => {
    expect(out.used).toEqual(['auth']);
    expect(out.sheets).toEqual(['chat']);
  });

  test('sets the viewport width so the screen sees its own metrics', () => {
    expect(out.html).toContain('width=390');
  });

  test('renders a placeholder instead of throwing on a missing item', () => {
    const missing = composeDocument({ doc, item: 'nope', ctx });
    expect(missing.html).toContain('Missing item');
    expect(missing.used).toEqual([]);
  });

  test('escapes a title that contains markup', () => {
    const evil: ProjectDoc = {
      ...doc,
      items: { ...doc.items, x: { ...authItem, description: '</title><script>' } },
    };
    expect(composeDocument({ doc: evil, item: 'x', ctx }).html).not.toContain('<script>');
  });
});

/* A theme that names a background should USE it. Declaring `--bg` does
   nothing on its own, and a project with no reset renders on the browser's
   white — content dark down to where the content stops, white below it. */
describe('the theme grounds the page', () => {
  const themed = (tokens: Record<string, string>) => themeCss({ label: 'T', tokens });

  test('a background token reaches the body', () => {
    const css = themed({ '--bg': '#0b0c10', '--text': '#e7e9f0' });

    expect(css).toContain('--bg: #0b0c10;');
    expect(css).toContain('background: var(--bg)');
    expect(css).toContain('color: var(--text)');
  });

  test('a theme that names no background invents none', () => {
    const css = themed({ '--accent': '#4a7cf7' });

    expect(css).not.toContain('body {');
    expect(css).toContain('--accent');
  });

  test('either token alone is enough for its own rule', () => {
    expect(themed({ '--bg': '#000' })).toContain('background: var(--bg)');
    expect(themed({ '--bg': '#000' })).not.toContain('color: var(--text)');
    expect(themed({ '--text': '#fff' })).toContain('color: var(--text)');
    expect(themed({ '--text': '#fff' })).not.toContain('background: var(--bg)');
  });

  /* It is a DEFAULT, not a decision: a project that grounds its own page has
     to win, or importing a design would repaint it. */
  test('it comes before the base stylesheet, so a project overrides it', () => {
    const own: ProjectDoc = {
      ...doc,
      kit: {
        ...doc.kit,
        base: 'body { background: rebeccapurple; }',
        themes: { dark: { label: 'Dark', tokens: { '--bg': '#000' } } },
      },
    };

    const css = composeStylesheet(own, 'dark');
    expect(css.indexOf('var(--bg)')).toBeLessThan(css.indexOf('rebeccapurple'));
  });
});
