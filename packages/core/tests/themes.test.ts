/* Themes and their tokens.
 *
 * Written after an agent tried to bring an existing design system in and found
 * it could set one token per call, could not remove one at all, and could not
 * say which theme a project renders in. It ended up editing the file directly
 * — which is the one thing the command layer exists to make unnecessary — and
 * left a token behind that no tool could take out again.
 */

import { describe, expect, test } from 'bun:test';
import type { ProjectDoc } from '../src/index';
import { apply, applyAll } from '../src/index';

function project(): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '',
      sheets: {},
      themes: {
        dark: { label: 'Dark', tokens: { '--bg': '#000', '--text': '#fff' } },
        light: { label: 'Light', tokens: { '--bg': '#fff', '--text': '#000' } },
      },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {},
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('taking a token out', () => {
  test('the name goes, not just its value', () => {
    const r = apply(project(), { t: 'theme.removeToken', theme: 'dark', token: '--text' });

    expect(r.doc?.kit.themes.dark?.tokens).toEqual({ '--bg': '#000' });
    expect('--text' in (r.doc?.kit.themes.dark?.tokens ?? {})).toBe(false);
  });

  test('and comes back on undo, with its value', () => {
    const gone = apply(project(), { t: 'theme.removeToken', theme: 'dark', token: '--text' });
    let back = gone.doc as ProjectDoc;
    for (const step of gone.inverse) back = (apply(back, step).doc ?? back) as ProjectDoc;

    expect(back.kit.themes.dark?.tokens['--text']).toBe('#fff');
  });

  test('removing one that is not there changes nothing', () => {
    const r = apply(project(), { t: 'theme.removeToken', theme: 'dark', token: '--nope' });

    expect(r.ok).toBe(true);
    expect(r.inverse).toEqual([]);
  });

  test('nor does naming a theme that does not exist', () => {
    const r = apply(project(), { t: 'theme.removeToken', theme: 'sepia', token: '--bg' });
    expect(r.inverse).toEqual([]);
  });

  /* The state the agent was stuck in: a token written into one theme only.
     Removing it from both is what puts the document back in order. */
  test('a token in one theme only can be cleared out of the document', () => {
    const stray = apply(project(), {
      t: 'theme.setToken',
      theme: 'light',
      token: '--probe',
      value: '',
    });
    const cleaned = applyAll(stray.doc as ProjectDoc, [
      { t: 'theme.removeToken', theme: 'light', token: '--probe' },
    ]);

    expect(cleaned.doc?.kit.themes.light?.tokens).toEqual({ '--bg': '#fff', '--text': '#000' });
  });
});

describe('which theme a design renders in', () => {
  test('can be changed', () => {
    const r = apply(project(), { t: 'kit.setDefaultTheme', theme: 'light' });
    expect(r.doc?.kit.defaultTheme).toBe('light');
  });

  test('and put back', () => {
    const changed = apply(project(), { t: 'kit.setDefaultTheme', theme: 'light' });
    const back = apply(changed.doc as ProjectDoc, changed.inverse[0] as never);

    expect(back.doc?.kit.defaultTheme).toBe('dark');
  });
});

describe('a palette arrives as one edit', () => {
  /* Forty tokens as forty commands is forty entries in the log, and a design
     half-converted at any point in between. */
  test('several tokens apply together or not at all', () => {
    const r = applyAll(project(), [
      { t: 'theme.setToken', theme: 'dark', token: '--bg', value: '#08090d' },
      { t: 'theme.setToken', theme: 'dark', token: '--ink', value: '#f0f0f5' },
      { t: 'theme.setToken', theme: 'dark', token: '--edge', value: 'rgba(255,255,255,.07)' },
    ]);

    expect(r.ok).toBe(true);
    expect(r.doc?.kit.themes.dark?.tokens).toEqual({
      '--bg': '#08090d',
      '--text': '#fff',
      '--ink': '#f0f0f5',
      '--edge': 'rgba(255,255,255,.07)',
    });
  });

  test('and undo as one', () => {
    const set = applyAll(project(), [
      { t: 'theme.setToken', theme: 'dark', token: '--ink', value: '#eee' },
      { t: 'theme.setToken', theme: 'dark', token: '--edge', value: '#333' },
    ]);
    let back = set.doc as ProjectDoc;
    for (const step of set.inverse) back = (apply(back, step).doc ?? back) as ProjectDoc;

    expect(back.kit.themes.dark?.tokens).toEqual({ '--bg': '#000', '--text': '#fff' });
  });
});
