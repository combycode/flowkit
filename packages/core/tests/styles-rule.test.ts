/* The check that would have caught it: an element lifted out of a header with
 * the header's stylesheets, while the class that draws it is written in
 * another one. Nothing about the markup looks wrong — it just renders as two
 * letters on a dark square. */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { validate } from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'element',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function project(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '.icon { width: 24px }',
      sheets: {
        chat: '.brief-pill { border: 1px solid var(--border) }',
        cabinet: '.avatar { border-radius: 50%; border: 1px solid var(--border) }',
      },
      themes: { dark: { label: 'Dark', tokens: { '--border': '#333' } } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {},
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
    ...over,
  };
}

const problems = (doc: ProjectDoc) => validate(doc).filter((p) => p.code === 'unstyled-class');

describe('unstyled-class', () => {
  test('names the class and the sheets the item does have', () => {
    const doc = project({
      items: { avatar: item({ html: '<button class="avatar">SM</button>', sheets: ['chat'] }) },
    });
    const [found] = problems(doc);

    expect(found?.message).toContain('.avatar');
    expect(found?.message).toContain('"chat"');
    expect(found?.severity).toBe('warning');
  });

  test('says nothing once the item names the sheet that draws it', () => {
    const doc = project({
      items: { avatar: item({ html: '<button class="avatar">SM</button>', sheets: ['cabinet'] }) },
    });

    expect(problems(doc)).toEqual([]);
  });

  test('the base stylesheet counts, and so does the item’s own CSS', () => {
    const doc = project({
      items: {
        icon: item({ html: '<svg class="icon"></svg>' }),
        nav: item({ html: '<nav class="shell-nav"></nav>', css: '.shell-nav { display: flex }' }),
      },
    });

    expect(problems(doc)).toEqual([]);
  });

  /* Loose on purpose: the question is whether a sheet was forgotten, not
     whether a particular selector is the one that wins. */
  test('a class inside a compound selector counts', () => {
    const doc = project({
      items: { row: item({ html: '<div class="row-edit"></div>', sheets: ['chat'] }) },
    });
    doc.kit.sheets.chat = '.row-user:hover .row-edit { opacity: 1 }';

    expect(problems(doc)).toEqual([]);
  });

  /* A state can use a class the base never does, in markup of its own or in
     the modifier itself. Reading only `html` would let either render bare. */
  test('a class that appears only in a variant is checked too', () => {
    const doc = project({
      items: {
        pill: item({
          html: '<span class="brief-pill"></span>',
          sheets: ['chat'],
          variants: { loud: { html: '<span class="brief-pill"><b class="ring"></b></span>' } },
        }),
      },
    });

    expect(problems(doc)[0]?.message).toContain('.ring');
  });

  test('and so is the modifier class a variant adds', () => {
    const doc = project({
      items: {
        pill: item({
          html: '<span class="brief-pill"></span>',
          sheets: ['chat'],
          variants: { done: { class: 'is-complete' } },
        }),
      },
    });

    expect(problems(doc)[0]?.message).toContain('.is-complete');
  });

  /* Their sheets are attached by the generator, not chosen by anyone. */
  test('a generated page is not asked about its stylesheets', () => {
    const doc = project({
      items: {
        'kit-elements': item({
          tier: 'screen',
          generated: 'kit',
          html: '<main class="kit"><div class="kit-stage"></div></main>',
        }),
      },
    });

    expect(problems(doc)).toEqual([]);
  });
});
