import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { exportHtml, fileNameOf, renderIndex, screensToExport } from '../src/index';
import { appDataDir, exportDir, workspaceDir } from '../src/paths';

const doc: ProjectDoc = {
  schema: 1,
  id: 't',
  name: 'Test Project',
  createdAt: '',
  updatedAt: '',
  kit: {
    preset: 'none',
    base: 'body { margin: 0; }',
    sheets: { chat: '.chat { display: flex; }' },
    themes: {
      dark: { label: 'Dark', tokens: { '--bg': '#000' } },
      light: { label: 'Light', tokens: { '--bg': '#fff' } },
    },
    defaultTheme: 'dark',
    fonts: [],
  },
  items: {
    home: {
      tier: 'screen',
      html: '<h1 data-t="home.hi">Hi</h1>',
      css: '.home { padding: 8px; }',
      sheets: ['chat'],
      props: {},
      fixtures: { default: { values: {} } },
    },
    about: {
      tier: 'screen',
      html: '<h1 data-t="about.t">About</h1>',
      props: {},
      fixtures: { default: { values: {} } },
    },
  },
  flow: {
    nodes: {
      n1: {
        screen: 'home',
        fixture: 'default',
        title: 'Home',
        order: 1,
        groups: ['main'],
        description: 'The landing screen',
      },
      n2: {
        screen: 'about',
        fixture: 'default',
        title: 'About',
        order: 2,
        groups: ['main'],
      },
    },
    edges: { e1: { from: 'n1', to: 'n2', label: 'learn more' } },
    groups: [{ id: 'main', label: 'Main' }],
  },
  strings: {
    defaultLocale: 'en',
    locales: {
      en: { label: 'English', entries: { 'home.hi': 'Hi', 'about.t': 'About' } },
      ru: { label: 'Русский', entries: { 'home.hi': 'Привет' } },
    },
  },
  assets: {},
  viewports: [
    { id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 },
    { id: 'desktop', label: 'Desktop', device: 'desktop', width: 1440, height: 900 },
  ],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-export-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('paths', () => {
  test('an explicit path wins', () => {
    expect(workspaceDir('/somewhere')).toBe('/somewhere');
  });

  test('projects live under the app data directory, not the source tree', () => {
    const resolved = workspaceDir();
    expect(resolved.startsWith(appDataDir())).toBe(true);
    expect(resolved).not.toContain('public');
  });

  test('exports land beside the project they came from', () => {
    // A design in a repo belongs with its code, and so do the pages generated
    // from it — not in an app-data folder nobody has reason to look in.
    expect(exportDir('D:/repo/design/app.json')).toBe(join('D:/repo/design', 'exports'));
  });

  test('and fall back to app data when there is no project to sit beside', () => {
    expect(exportDir().startsWith(appDataDir())).toBe(true);
  });
});

describe('screensToExport', () => {
  test('covers every screen at every size in every theme by default', () => {
    // 2 screens x 2 viewports x 2 themes. A sheet exported with one theme has
    // a theme switcher that does nothing.
    expect(screensToExport(doc, {}).length).toBe(8);
  });

  test('but only the default locale — a translation is a review pass, not a variant', () => {
    expect(new Set(screensToExport(doc, {}).map((j) => j.ctx.locale))).toEqual(new Set(['en']));
  });

  test('follows flow order rather than object order', () => {
    const jobs = screensToExport(doc, { viewports: ['mobile'], themes: ['dark'] });
    expect(jobs.map((j) => j.item)).toEqual(['home', 'about']);
  });

  test('narrows to exactly what was asked for', () => {
    const jobs = screensToExport(doc, { viewports: ['mobile'], themes: ['light'] });
    expect(jobs.length).toBe(2);
    expect(jobs.every((j) => j.ctx.theme === 'light')).toBe(true);
  });

  test('carries the node title and caption, not just the item name', () => {
    const [home] = screensToExport(doc, {});
    expect(home?.label).toBe('Home');
    expect(home?.description).toBe('The landing screen');
  });

  test('falls back rather than failing the whole export on an unknown axis', () => {
    const jobs = screensToExport(doc, { themes: ['nope'] });
    expect(new Set(jobs.map((j) => j.ctx.theme))).toEqual(new Set(['dark', 'light']));
  });

  test('ignores a screen that does not exist', () => {
    const jobs = screensToExport(doc, { screens: ['home', 'ghost'], viewports: ['mobile'] });
    expect(jobs.every((j) => j.item === 'home')).toBe(true);
  });
});

describe('fileNameOf', () => {
  test('omits the default theme and locale, so names stay readable', () => {
    const [job] = screensToExport(doc, {});
    expect(fileNameOf(doc, job!)).toBe('home@mobile.html');
  });

  test('names every axis that varies, so renders cannot collide', () => {
    const jobs = screensToExport(doc, { themes: ['light'], locales: ['ru'] });
    expect(fileNameOf(doc, jobs[0]!)).toBe('home@mobile-light-ru.html');
  });
});

describe('exportHtml', () => {
  test('writes one page per screen, size and theme, plus an index', async () => {
    const result = await exportHtml(doc, { outDir: dir });
    expect(result.files.length).toBe(8); // 2 screens x 2 viewports x 2 themes
    expect(await readdir(join(dir, 'screens'))).toContain('home@mobile.html');
    expect(await readdir(join(dir, 'screens'))).toContain('home@desktop-light.html');
    expect(result.indexPath).toBe(join(dir, 'index.html'));
  });

  // Regression: inlining put the stylesheet and the fonts into every page, so
  // 62 screens came to 73 MB of mostly identical bytes.
  test('shares one stylesheet per theme instead of inlining it per page', async () => {
    const result = await exportHtml(doc, { outDir: dir, themes: ['dark'] });
    expect(result.stylesheets).toEqual(['assets/kit-dark.css']);

    const page = await readFile(join(dir, 'screens', 'home@mobile.html'), 'utf8');
    expect(page).toContain('<link rel="stylesheet" href="../assets/kit-dark.css">');
    expect(page).not.toContain('<style>');

    const css = await readFile(join(dir, 'assets', 'kit-dark.css'), 'utf8');
    expect(css).toContain('--bg: #000');
    expect(css).toContain('.chat { display: flex; }');
    expect(css).toContain('.home { padding: 8px; }');
  });

  test('inline mode restores a page that stands on its own', async () => {
    await exportHtml(doc, { outDir: dir, inline: true, themes: ['dark'], viewports: ['mobile'] });
    const page = await readFile(join(dir, 'screens', 'home@mobile.html'), 'utf8');
    expect(page).toContain('<style>');
    expect(page).not.toContain('<link rel="stylesheet"');
    expect(page).toContain('--bg: #000');
  });

  test('one stylesheet per theme when several are exported', async () => {
    const result = await exportHtml(doc, { outDir: dir });
    expect(result.stylesheets.sort()).toEqual(['assets/kit-dark.css', 'assets/kit-light.css']);
  });

  test('applies the locale overlay to the exported markup', async () => {
    await exportHtml(doc, {
      outDir: dir,
      locales: ['ru'],
      themes: ['dark'],
      viewports: ['mobile'],
    });
    const page = await readFile(join(dir, 'screens', 'home@mobile-ru.html'), 'utf8');
    expect(page).toContain('Привет');
  });
});

describe('the index', () => {
  const index = () =>
    renderIndex({
      doc,
      jobs: screensToExport(doc, {}),
      fileOf: (j) => `screens/${fileNameOf(doc, j)}`,
    });

  test('frames every screen at every size and theme', () => {
    expect((index().match(/class="cell"/g) ?? []).length).toBe(8);
  });

  test('builds its filters from the document', () => {
    expect(index()).toContain('>Main<');
  });

  test('shows what a screen connects to', () => {
    expect(index()).toContain('learn more');
    expect(index()).toContain('About');
  });

  // The point of the wider default: a sheet exported with one theme showed a
  // theme switcher that did nothing, which is worse than a bigger export.
  test('carries a working theme and size switcher by default', () => {
    expect(index()).toContain('data-filter="theme"');
    expect(index()).toContain('data-filter="viewport"');
    expect(index()).toContain('>Dark<');
    expect(index()).toContain('>Light<');
  });

  test('omits a filter that would have only one option', () => {
    // Only the default locale is exported, so a language control would be dead.
    expect(index()).not.toContain('data-filter="locale"');
  });

  test('shows the language filter once a second locale is exported', () => {
    const jobs = screensToExport(doc, { locales: ['en', 'ru'] });
    const html = renderIndex({ doc, jobs, fileOf: (j) => fileNameOf(doc, j) });
    expect(html).toContain('data-filter="locale"');
  });

  test('escapes a project name that contains markup', () => {
    const evil = { ...doc, name: '</title><script>alert(1)</script>' };
    const html = renderIndex({ doc: evil, jobs: [], fileOf: () => 'x.html' });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  test('a phone frame and a desktop frame are styled apart', () => {
    const jobs = screensToExport(doc, { viewports: ['mobile', 'desktop'] });
    const html = renderIndex({ doc, jobs, fileOf: (j) => fileNameOf(doc, j) });
    expect(html).toContain('frame--mobile');
    expect(html).toContain('frame--desktop');
  });
});
