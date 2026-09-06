/* Renaming an item moves the NAME everywhere it is used.
 *
 * The bug this exists to stop: a rename that only renamed the key in `items`
 * left canvas nodes pointing at the old screen, `<x-oldname>` in other markup,
 * and slot fills all dangling — so the design still validated by name but
 * exported as black "Missing item" plates. The name lives in four places; a
 * rename that does not move all four is a silent corruption.
 */

import { describe, expect, test } from 'bun:test';
import type { ProjectDoc } from '../src/index';
import { apply } from '../src/index';

/** A doc that references `card` every way an item can be referenced. */
function doc(): ProjectDoc {
  return {
    schema: 1,
    id: 't',
    name: 'T',
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
    items: {
      card: {
        tier: 'component',
        html: '<div class="card"><x-slot/></div>',
        props: {},
        fixtures: { default: { values: {} } },
        variants: { loud: { html: '<div class="card is-loud"><x-slot/></div>' } },
      },
      home: {
        tier: 'screen',
        // references card two ways, and something that only STARTS with card
        html: '<main><x-card variant="loud"/><x-card></x-card><x-cardholder/></main>',
        props: {},
        fixtures: { default: { values: {} } },
      },
      shell: {
        tier: 'layout',
        html: '<body><x-slot name="body"/></body>',
        props: {},
        fixtures: { default: { values: {} } },
      },
      cardholder: {
        tier: 'component',
        html: '<div class="cardholder"></div>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: {
      nodes: {
        n1: {
          screen: 'home',
          layout: 'shell',
          fixture: 'default',
          slots: {
            body: { kind: 'screen', screen: 'card', fixture: 'default' },
            aside: { kind: 'item', item: 'card' },
          },
        },
        n2: { screen: 'card', fixture: 'default' },
      },
      edges: {},
      groups: [],
    },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('renaming an item', () => {
  const renamed = () => apply(doc(), { t: 'item.rename', from: 'card', to: 'panel' });

  test('the item itself moves under the new key', () => {
    const d = renamed().doc as ProjectDoc;
    expect(d.items.panel).toBeDefined();
    expect(d.items.card).toBeUndefined();
  });

  test('a node pointing at it as a screen follows', () => {
    const d = renamed().doc as ProjectDoc;
    expect(d.flow.nodes.n2?.screen).toBe('panel');
  });

  test('composer references in other markup follow — both open and close tags', () => {
    const d = renamed().doc as ProjectDoc;
    expect(d.items.home?.html).toContain('<x-panel variant="loud"/>');
    expect(d.items.home?.html).toContain('<x-panel></x-panel>');
  });

  /* The trap in a text rewrite: `card` is a prefix of `cardholder`. */
  test('a different item that merely starts with the name is untouched', () => {
    const d = renamed().doc as ProjectDoc;
    expect(d.items.home?.html).toContain('<x-cardholder/>');
    expect(d.items.cardholder).toBeDefined();
  });

  test('references inside a variant’s own markup follow too', () => {
    // card's own variant references x-slot (structural, unchanged); rename a
    // component that a variant composes to prove variant html is rewritten.
    const d = apply(doc(), { t: 'item.rename', from: 'cardholder', to: 'holder' })
      .doc as ProjectDoc;
    expect(d.items.home?.html).toContain('<x-holder/>');
  });

  test('slot fills that name it follow', () => {
    const d = renamed().doc as ProjectDoc;
    const slots = d.flow.nodes.n1?.slots;
    expect(slots?.body).toEqual({ kind: 'screen', screen: 'panel', fixture: 'default' });
    expect(slots?.aside).toEqual({ kind: 'item', item: 'panel' });
  });

  test('a node’s layout reference follows', () => {
    const d = apply(doc(), { t: 'item.rename', from: 'shell', to: 'chrome' }).doc as ProjectDoc;
    expect(d.flow.nodes.n1?.layout).toBe('chrome');
  });

  /* The property that matters end to end: nothing still names the old item. */
  test('no reference to the old name survives anywhere', () => {
    const d = renamed().doc as ProjectDoc;
    const json = JSON.stringify(d);
    expect(json).not.toContain('x-card"');
    expect(json).not.toContain('x-card>');
    expect(json).not.toContain('x-card ');
    expect(json).not.toContain('"screen":"card"');
    expect(json).not.toContain('"item":"card"');
  });

  test('undo puts every reference back', () => {
    const r = renamed();
    let back = r.doc as ProjectDoc;
    for (const step of r.inverse) back = (apply(back, step).doc ?? back) as ProjectDoc;
    expect(back).toEqual(doc());
  });

  test('renaming onto a taken name is refused, nothing moves', () => {
    const r = apply(doc(), { t: 'item.rename', from: 'card', to: 'home' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('duplicate-name');
    expect(r.doc).toBeUndefined();
  });
});
