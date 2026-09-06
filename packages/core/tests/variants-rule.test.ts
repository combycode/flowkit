/* The hole that opened the moment a variant could bring markup of its own: the
 * call site fills a slot, the state it happens to be rendering has no such
 * slot, and the words are dropped. Nothing throws and nothing looks empty —
 * the text is simply not on that one screen. */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { validate } from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'component',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function project(items: Record<string, Item>): ProjectDoc {
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
      themes: { dark: { label: 'Dark', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items,
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

const problems = (doc: ProjectDoc) => validate(doc).filter((p) => p.code === 'variant-slots');

describe('variant-slots', () => {
  test('a variant whose markup drops a slot is reported', () => {
    const doc = project({
      card: item({
        html: '<div><x-slot name="label"/><x-slot/></div>',
        variants: { bare: { html: '<div><x-slot/></div>' } },
      }),
    });
    const [found] = problems(doc);

    expect(found?.message).toContain('"label"');
    expect(found?.severity).toBe('warning');
  });

  test('and one that invents a slot the base has not got', () => {
    const doc = project({
      card: item({
        html: '<div><x-slot/></div>',
        variants: { rich: { html: '<div><x-slot/><x-slot name="aside"/></div>' } },
      }),
    });

    expect(problems(doc)[0]?.message).toContain('"aside"');
  });

  test('the same slots in a different arrangement is fine', () => {
    const doc = project({
      panel: item({
        html: '<aside><x-slot name="head"/><x-slot/></aside>',
        variants: {
          modal: { html: '<div class="scrim"></div><aside><x-slot name="head"/><x-slot/></aside>' },
        },
      }),
    });

    expect(problems(doc)).toEqual([]);
  });

  /* The common case by far: state is a class, the markup is the item's. */
  test('a variant that inherits cannot drift, and is not checked', () => {
    const doc = project({
      card: item({
        html: '<div><x-slot name="label"/></div>',
        variants: { on: { class: 'is-on' }, off: { attrs: { hidden: '' } } },
      }),
    });

    expect(problems(doc)).toEqual([]);
  });
});
