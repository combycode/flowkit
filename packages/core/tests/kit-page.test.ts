/* The kit pages. What they must never be is a picture of a design system that
 * has moved on — so most of this is about staying true to the registry. */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import {
  kitPages,
  kitSheet,
  registryItems,
  staleKitPages,
  stringUnits,
  validate,
} from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'component',
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
      base: '',
      sheets: {},
      themes: {
        dark: {
          label: 'Dark',
          tokens: {
            '--bg': '#0e1014',
            '--accent': '#4f7cf7',
            '--text-md': '1rem',
            '--space-4': '16px',
            '--font-sans': 'system-ui',
          },
        },
      },
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

const named = (doc: ProjectDoc, name: string): string =>
  kitPages(doc).find((p) => p.name === name)?.html ?? '';

describe('the foundation sheet', () => {
  /* Colour, type, sizes and icons are the vocabulary rather than the design:
     short, and the only part of a kit that exists before anything has been
     extracted. */
  test('carries all four, on one page', () => {
    const html = named(project(), 'kit-foundation');

    expect(html).toContain('>Colour<');
    expect(html).toContain('>Type<');
    expect(html).toContain('>Sizes<');
    expect(html).toContain('>Icons<');
  });

  test('a token appears under the heading it belongs to', () => {
    const html = named(project(), 'kit-foundation');

    expect(html).toContain('--accent');
    expect(html).toContain('#4f7cf7');
    expect(html).toContain('--text-md');
    expect(html).toContain('--space-4');
  });

  test('a project with no tokens says so rather than rendering a broken page', () => {
    const bare = project();
    bare.kit.themes.dark = { label: 'Dark', tokens: {} };
    const html = named(bare, 'kit-foundation');

    expect(html).toContain('No colour tokens yet');
    expect(html).toContain('No size tokens yet');
  });

  /* Icons come from the SPRITE, not the registry: an icon is a glyph whether
     or not anyone has lifted it into an item, so the sheet is complete on the
     first day of a project. */
  test('every glyph the sprite defines is on it, once', () => {
    const doc = project({
      items: {
        home: item({
          tier: 'screen',
          html: '<svg><symbol id="i-back"><path d="M0 0"/></symbol></svg><main></main>',
        }),
        other: item({
          tier: 'screen',
          html: '<svg><symbol id="i-back"><path d="M0 0"/></symbol><symbol id="i-send"/></svg>',
        }),
      },
    });
    const html = named(doc, 'kit-foundation');

    expect(html.match(/<symbol id="i-back">/g)).toHaveLength(1);
    expect(html).toContain('<use href="#i-back"/>');
    expect(html).toContain('<use href="#i-send"/>');
  });

  test('a design that draws no icons says that instead of showing an empty grid', () => {
    expect(named(project(), 'kit-foundation')).toContain('No icons');
  });

  /* Otherwise a rebuild copies the last build's sprite into the next one, and
     a glyph the design has dropped lives on in the kit. */
  test('a generated page is not a source of glyphs', () => {
    const doc = project({
      items: {
        'kit-old': item({
          tier: 'screen',
          generated: 'kit',
          html: '<svg><symbol id="i-gone"/></svg>',
        }),
      },
    });

    expect(named(doc, 'kit-foundation')).not.toContain('i-gone');
  });
});

describe('the registry sheets', () => {
  const withRegistry = () =>
    project({
      items: {
        dot: item({ tier: 'element', html: '<span class="dot"></span>' }),
        card: item({ tier: 'component', html: '<div class="card"><x-slot/></div>' }),
        list: item({ tier: 'container', html: '<div class="list"><x-slot/></div>' }),
        shell: item({ tier: 'layout', html: '<main class="shell"><x-slot/></main>' }),
        home: item({ tier: 'screen', html: '<main><x-card>Hello</x-card></main>' }),
      },
    });

  /* One page of everything was thirty rows long and read as a scroll rather
     than a sheet. Split by tier, each one is short enough to look at. */
  test('are split by tier, in the order a design is built', () => {
    expect(kitPages(withRegistry()).map((p) => p.name)).toEqual([
      'kit-foundation',
      'kit-elements',
      'kit-components',
      'kit-containers',
      'kit-layouts',
    ]);
  });

  test('an element is on the element sheet and nowhere else', () => {
    const doc = withRegistry();

    expect(named(doc, 'kit-elements')).toContain('<x-dot/>');
    expect(named(doc, 'kit-components')).not.toContain('<x-dot/>');
  });

  /* A container is not a component: it holds them, and it often places itself
     on the page rather than sitting where it is put. Its own sheet is how the
     tiers stay visible in the kit. */
  test('a container has a sheet of its own', () => {
    expect(named(withRegistry(), 'kit-containers')).toContain('list');
    expect(named(withRegistry(), 'kit-components')).not.toContain('>list<');
  });

  test('a sheet with nothing on it is not written at all', () => {
    expect(kitPages(project()).map((p) => p.name)).toEqual(['kit-foundation']);
  });

  /* The cell is the real item, referenced through the composer. A page that
     DESCRIBED a button could show one that no longer exists. */
  test('a cell references the item rather than copying it', () => {
    const doc = project({
      items: {
        button: item({
          tier: 'element',
          html: '<button class="b">Go</button>',
          variants: { quiet: { class: 'is-quiet' } },
        }),
      },
    });
    const html = named(doc, 'kit-elements');

    expect(html).toContain('<x-button/>');
    expect(html).toContain('<x-button variant="quiet"/>');
    expect(html).not.toContain('<button class="b">');
  });

  /* A part with a slot renders as an empty box on its own, and a page of empty
     boxes says nothing about the design. */
  test('a slot is filled from the first screen that really uses it', () => {
    expect(named(withRegistry(), 'kit-components')).toContain('<x-card>Hello</x-card>');
  });

  /* A media query looks at the WINDOW. Drawn straight onto a 1536-wide sheet,
     every part shows its desktop self whatever the toolbar says — and the one
     that is `display: none` above 1200px showed as an empty box. */
  test('a part is drawn in a window of its own, sized to what it holds', () => {
    const html = named(withRegistry(), 'kit-components');

    expect(html).toContain('data-fit="content"');
    expect(html).toContain('<iframe class="kit-frame"');
  });

  /* `<x-f` also begins `<x-fill`, which is the composer's own tag rather than a
     nested call. Counted as one, the search for the call's end never balances,
     and a real item shows up on the sheet as an empty box. */
  test('a one-letter name is not confused with <x-fill>', () => {
    const doc = project({
      items: {
        f: item({ html: '<div class="f"><x-slot name="label"/><x-slot/></div>' }),
        home: item({
          tier: 'screen',
          html: '<main><x-f><x-fill slot="label">Budget</x-fill>$1,240</x-f></main>',
        }),
      },
    });

    expect(named(doc, 'kit-components')).toContain(
      '<x-f><x-fill slot="label">Budget</x-fill>$1,240</x-f>',
    );
  });

  test('screens and generated pages are not in the registry', () => {
    const doc = project({
      items: {
        home: item({ tier: 'screen', html: '<main></main>' }),
        'kit-foundation': item({ tier: 'screen', html: '<main></main>', generated: 'kit' }),
        chip: item({ tier: 'element', html: '<i></i>' }),
      },
    });

    expect(registryItems(doc)).toEqual(['chip']);
  });
});

describe('staying true', () => {
  /* A generated page that has fallen behind is worse than no page: it shows a
     design system that does not exist, and nothing about it looks wrong. */
  test('a page is stale once the registry moves under it', () => {
    const doc = project({ items: { chip: item({ tier: 'element', html: '<i></i>' }) } });
    for (const page of kitPages(doc)) {
      doc.items[page.name] = item({ tier: 'screen', html: page.html, generated: 'kit' });
    }
    expect(staleKitPages(doc)).toEqual([]);

    // A new variant nobody rebuilt for.
    doc.items.chip = item({
      tier: 'element',
      html: '<i></i>',
      variants: { on: { class: 'is-on' } },
    });
    expect(staleKitPages(doc)).toEqual(['kit-elements']);
  });

  test('a page that was never built is not reported as stale', () => {
    expect(staleKitPages(project())).toEqual([]);
  });
});

describe('generated pages are not product copy', () => {
  const withKit = () => {
    const doc = project();
    for (const page of kitPages(doc)) {
      doc.items[page.name] = item({ tier: 'screen', html: page.html, generated: 'kit' });
    }
    return doc;
  };

  /* Otherwise a translator is handed a hundred developer labels — "element",
     "default", "Generated from the registry" — and charges for them. */
  test('their text is never offered for translation', () => {
    expect(stringUnits(withKit())).toEqual([]);
  });

  test('and never complained about for lacking string keys', () => {
    const problems = validate(withKit());
    expect(problems.filter((p) => p.code === 'untranslated-text')).toEqual([]);
  });
});

/* The kit page draws its own chrome, and two spots misfired: a size bar wider
 * than the sheet pushed its own caption off-screen, and the icon stage read
 * the design's tokens by name — a project with its own vocabulary got a
 * near-white icon on a near-white ground. */
describe('the kit page chrome', () => {
  const css = kitSheet();
  /** One CSS rule's body, from its selector to the closing brace. */
  const rule = (selector: string): string => {
    const at = css.indexOf(selector);
    return at === -1 ? '' : css.slice(at, css.indexOf('}', at) + 1);
  };

  test('a size bar is capped to the page it is drawn on', () => {
    expect(rule('.kit-bar')).toContain('max-width: 100%');
  });

  test('the icon stage does not depend on the design’s own token names', () => {
    const stage = rule('.kit-icon__stage');
    // it used var(--bg)/var(--text) — undefined in a project with another
    // vocabulary, leaving a light glyph on a light chip.
    expect(stage).not.toContain('var(--text,');
    expect(stage).not.toContain('var(--bg,');
    expect(stage).toContain('var(--kit-ink)');
  });
});

/* A container is neither a part nor a shell. The showcase drew it as a shell:
 * one frame, captioned with a viewport, and none of its variants — and a
 * sidebar that is off-screen on a phone came out an empty card. It now gets a
 * frame per variant, at the width it is designed for. */
describe('a container on the kit page', () => {
  const withContainer = (over: Partial<Item> = {}) =>
    project({
      viewports: [
        { id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 },
        { id: 'desktop', label: 'Desktop', device: 'desktop', width: 1440, height: 900 },
      ],
      items: {
        side: item({
          tier: 'container',
          html: '<aside class="side"><x-slot/></aside>',
          variants: { 'with-mandate': { class: 'is-mandate' }, mini: { class: 'is-mini' } },
          ...over,
        }),
        home: item({ tier: 'screen', html: '<main><x-side/></main>' }),
      },
    });

  test('is on the containers sheet, drawn as a windowed frame', () => {
    const html = named(withContainer(), 'kit-containers');
    expect(html).toContain('<iframe class="kit-frame"');
    // A window, not a content-fit cell — a fixed sidebar needs a viewport.
    expect(html).not.toContain('data-fit="content"');
  });

  test('shows one frame per variant, captioned by the variant', () => {
    const html = named(withContainer(), 'kit-containers');
    // default + two variants = three frames.
    expect(html.match(/<iframe class="kit-frame"/g)).toHaveLength(3);
    expect(html).toContain('>default<');
    expect(html).toContain('>with-mandate<');
    expect(html).toContain('>mini<');
  });

  test('is drawn at its own designed viewport when it declares one', () => {
    const html = named(withContainer({ viewport: 'desktop' }), 'kit-containers');
    expect(html).toContain('data-viewport="desktop"');
  });

  test('follows the toolbar when it declares no viewport of its own', () => {
    const html = named(withContainer(), 'kit-containers');
    // No viewport pinned -> empty data-viewport, so the frame follows the page.
    expect(html).toContain('data-viewport=""');
  });
});

/* Same fix on the layout side: a shell designed at desktop should draw there,
 * not at whatever the toolbar last showed. */
describe('a layout honours its designed viewport', () => {
  test('a pinned viewport reaches the shell frame', () => {
    const doc = project({
      viewports: [
        { id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 },
        { id: 'desktop', label: 'D', device: 'desktop', width: 1440, height: 900 },
      ],
      items: {
        shell: item({
          tier: 'layout',
          html: '<main class="shell"><x-slot/></main>',
          viewport: 'desktop',
        }),
        home: item({ tier: 'screen', html: '<main><x-shell>hi</x-shell></main>' }),
      },
    });
    expect(named(doc, 'kit-layouts')).toContain('data-viewport="desktop"');
  });
});
