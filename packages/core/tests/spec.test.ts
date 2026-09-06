/* The specification. What it has to get right is not prose but honesty: the
 * copy exactly as it will ship, the connections as they are drawn, and a
 * closing section that names what nobody decided instead of quietly omitting
 * it. */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { writeSpec } from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'screen',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function project(): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'Shop',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '',
      sheets: {},
      themes: {
        dark: {
          label: 'Dark',
          tokens: {
            '--bg': '#08090d',
            '--sp-2': '8px',
            '--font-body': "'DM Sans', sans-serif",
            '--lh-body': '1.7',
            '--panel-bg': 'var(--bg)',
            '--shadow': '0 2px 8px rgb(0 0 0 / 40%)',
            '--only-dark': '#123456',
          },
        },
        light: {
          label: 'Light',
          tokens: {
            '--bg': '#ffffff',
            '--sp-2': '8px',
            '--font-body': "'DM Sans', sans-serif",
            '--lh-body': '1.7',
            '--panel-bg': 'var(--bg)',
            '--shadow': '0 2px 8px rgb(0 0 0 / 12%)',
          },
        },
      },
      defaultTheme: 'dark',
      fonts: [
        { family: 'DM Sans', weight: '400', style: 'normal', asset: 'f1' },
        { family: 'DM Sans', weight: '700', style: 'normal', asset: 'f2' },
      ],
    },
    items: {
      cart: item({
        html: '<main><h1 data-t="cart.title">Your basket</h1><x-tally/><p data-t="cart.empty">Nothing here yet</p></main>',
        meta: { reads: ['orders'] },
      }),
      pay: item({ html: '<main><h1 data-t="pay.title">Pay</h1></main>' }),
      tally: {
        tier: 'component',
        html: '<b class="tally"><x-slot/></b>',
        props: {},
        fixtures: { default: { values: {} } },
        description: 'The running total',
        variants: { loud: { class: 'is-loud' } },
      },
    },
    flow: {
      nodes: {
        cart: {
          screen: 'cart',
          fixture: 'default',
          title: 'Basket',
          order: 1,
          groups: ['buy'],
          meta: { role: 'shopper' },
        },
        pay: { screen: 'pay', fixture: 'default', title: 'Payment', order: 2, groups: ['buy'] },
      },
      edges: {
        'e-1': { from: 'cart', to: 'pay', label: 'checkout' },
        'e-2': { from: 'pay', to: 'cart', origin: 'auto' },
      },
      groups: [{ id: 'buy', label: 'Buying' }],
    },
    strings: {
      defaultLocale: 'en',
      locales: {
        en: {
          label: 'English',
          entries: {
            'cart.title': 'Your basket',
            'cart.empty': 'Nothing here yet',
            'pay.title': 'Pay',
          },
        },
      },
    },
    assets: {},
    viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('what a screen section says', () => {
  const spec = () => writeSpec(project());

  test('the screens come in flow order, under their flow', () => {
    const text = spec();
    expect(text.indexOf('## Buying')).toBeLessThan(text.indexOf('### 1. Basket'));
    expect(text.indexOf('### 1. Basket')).toBeLessThan(text.indexOf('### 2. Payment'));
  });

  /* The copy was quoted here once, key by key. Expanded through its
     components a screen carries hundreds, most of them a word on a chip, and
     the picture above says it better. It lives in the strings export now. */
  test('the copy is not quoted — that is what the strings export is for', () => {
    const text = spec();
    expect(text).not.toContain('What it says');
    expect(text).not.toContain('- Nothing here yet');
  });

  test('meta is carried through as written, from the node and the item', () => {
    const text = spec();
    expect(text).toContain('**role** — shopper');
    expect(text).toContain('**reads** — `["orders"]`');
  });

  test('what a screen is built from is named', () => {
    expect(spec()).toContain('**Built from** — `tally`');
  });

  test('and what leads in and out, with the condition on it', () => {
    const text = spec();
    expect(text).toContain('**checkout** → Payment');
    expect(text).toContain('**Reached from** — Basket (checkout)');
  });

  test('a guess by the importer is marked as one', () => {
    expect(spec()).toContain('assumed by the importer');
  });
});

describe('the design system section', () => {
  test('lists the parts with their states', () => {
    const text = writeSpec(project());
    expect(text).toContain('| `tally` | component | loud | The running total |');
  });

  test('and does not list the screens', () => {
    expect(writeSpec(project())).not.toContain('| `cart` |');
  });

  /* A part can be rebuilt from a picture of it. A palette cannot: nobody reads
     #08090d off a screenshot, and every one of these is a decision somebody
     made once and everything else obeys. */
  test('the palette is written out, a column per theme', () => {
    const text = writeSpec(project());
    expect(text).toContain('| Token | Dark | Light |');
    expect(text).toContain('| `--bg` | `#08090d` | `#ffffff` |');
  });

  test('a token one theme is missing shows as missing', () => {
    expect(writeSpec(project())).toContain('| `--only-dark` | `#123456` | — |');
  });

  /* Grouped by what the value is, because the names are the design's own —
     `--fs-body` in one project, `--text-size-body` in the next. */
  test('tokens are grouped by what the value is, not by its name', () => {
    const text = writeSpec(project());
    for (const [heading, token] of [
      ['### Colour', '`--bg`'],
      ['### Size and spacing', '`--sp-2`'],
      ['### Type', '`--font-body`'],
      ['### Named for a purpose', '`--panel-bg`'],
      ['### Everything else', '`--shadow`'],
    ]) {
      const at = text.indexOf(heading as string);
      expect(at).toBeGreaterThan(-1);
      const next = text.indexOf('### ', at + 4);
      expect(text.slice(at, next === -1 ? undefined : next)).toContain(token as string);
    }
  });

  test('a bare number is a line height, not a size', () => {
    const text = writeSpec(project());
    const type = text.indexOf('### Type');
    const after = text.indexOf('### ', type + 4);
    expect(text.slice(type, after)).toContain('`--lh-body`');
  });

  test('the typefaces are named with their weights, once each', () => {
    const text = writeSpec(project());
    expect(text).toContain('- **DM Sans** — 400, 700');
    expect(text.match(/\*\*DM Sans\*\*/g)).toHaveLength(1);
  });

  test('the values come before the parts built out of them', () => {
    const text = writeSpec(project());
    expect(text.indexOf('### Colour')).toBeLessThan(text.indexOf('### Parts'));
  });

  /* A part never gets a section of its own, so a note left on one has nowhere
     else to surface — and notes are where the thing it stands for is named. */
  test('a note left on a part is carried into the table', () => {
    const doc = project();
    const tally = doc.items.tally;
    if (tally) tally.meta = { maps_to: 'OrderTotal', currency: 'minor units' };

    const text = writeSpec(doc);
    expect(text).toContain('| Part | Kind | States | What it is | Notes |');
    expect(text).toContain('**maps\\_to** OrderTotal; **currency** minor units |');
  });

  test('and the column is absent when nobody left one', () => {
    expect(writeSpec(project())).toContain('| Part | Kind | States | What it is |\n');
  });

  test('a project with no tokens says nothing about them', () => {
    const doc = project();
    doc.kit.themes = { dark: { label: 'Dark', tokens: {} } };
    doc.kit.fonts = [];

    const text = writeSpec(doc);
    expect(text).not.toContain('### Colour');
    expect(text).toContain('### Parts');
  });
});

describe('what it does not answer', () => {
  /* Counting every edge in the project put "53 connections were guessed" at the
     end of a specification for twelve screens — a number the reader cannot
     check against anything in front of them. */
  test('counts only what this document covers', () => {
    const doc = project();
    doc.flow.nodes.stray = { screen: 'pay', fixture: 'default', title: 'Stray' };
    doc.flow.edges['e-3'] = { from: 'stray', to: 'cart', origin: 'auto' };

    const text = writeSpec(doc, { groups: ['buy'] });
    expect(text).toContain('**1 connection** was guessed');
  });

  test('names dead ends and unreachable screens', () => {
    const doc = project();
    delete doc.flow.edges['e-2'];

    const text = writeSpec(doc);
    expect(text).toContain('**Nothing leads away from** Payment');
    expect(text).toContain('**Nothing leads to** Basket');
  });

  test('and says nothing at all when there is nothing to say', () => {
    expect(writeSpec(project())).not.toContain('Nothing leads away from');
  });
});

/* Found in an export, not in a test: a spec asked for without the kit sheets
 * photographed 66 screens and then wrote 71 sections, five of them with a
 * heading, no picture and nothing to say. Whoever renders decides the scope. */
describe('the spec covers exactly the screens it was given', () => {
  test('a screen left out gets no section', () => {
    const text = writeSpec(project(), { screens: ['cart'] });
    expect(text).toContain('### 1. Basket');
    expect(text).not.toContain('### 2. Payment');
  });

  /* But where it LEADS is still named. A journey that continues into a flow
     this document does not cover is exactly what the reader has to be told. */
  test('a way out of the covered set is still drawn', () => {
    const text = writeSpec(project(), { screens: ['cart'] });
    expect(text).toContain('**checkout** → Payment');
    expect(text).not.toContain('Nothing leads away from');
  });

  test('and the header counts what is in front of the reader', () => {
    expect(writeSpec(project())).toContain('2 screens in 1 flow');
    expect(writeSpec(project(), { screens: ['cart'] })).toContain('1 screen in 1 flow');
  });

  test('a flow left with no screens is dropped, not printed empty', () => {
    const doc = project();
    doc.flow.groups.push({ id: 'admin', label: 'Admin' });
    doc.flow.nodes.settings = {
      screen: 'pay',
      fixture: 'default',
      title: 'Settings',
      groups: ['admin'],
    };

    expect(writeSpec(doc, { screens: ['cart'] })).not.toContain('## Admin');
  });

  test('the gaps section narrows with it', () => {
    const text = writeSpec(project(), { screens: ['cart'] });
    expect(text).not.toContain('was guessed');
  });

  test('the design system is not narrowed — those get built either way', () => {
    expect(writeSpec(project(), { screens: ['cart'] })).toContain('| `tally` | component |');
  });
});

describe('mockups', () => {
  test('a screen that is still a picture says so', () => {
    const doc = project();
    doc.items.cart = item({ html: '', image: 'shot' });

    const text = writeSpec(doc);
    expect(text).toContain('Still a mockup');
    expect(text).toContain('1 screen is still a mockup');
  });
});
