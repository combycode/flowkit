/* The composer. The promise it has to keep is exact: extracting a component
 * moves markup and changes nothing about the render. Every test here is
 * really the same test — the bytes came out where they went in. */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { addClass, expand, withoutClass } from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'component',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function doc(items: Record<string, Item>): ProjectDoc {
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
      themes: { dark: { label: 'D', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items,
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'E', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

const run = (items: Record<string, Item>, screenHtml: string) => {
  const screen = item({ tier: 'screen', html: screenHtml });
  const d = doc({ ...items, screen });
  return expand(d, screenHtml, screen);
};

describe('references', () => {
  test('an item with no references expands to itself, byte for byte', () => {
    const html = '<main class="a">\n  <p>Hello</p>\n</main>';
    const out = run({}, html);

    expect(out.html).toBe(html);
    expect(out.used).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  test('a self-closing reference becomes the item’s markup', () => {
    const out = run(
      { hdr: item({ html: '<header class="hdr">Top</header>' }) },
      '<div><x-hdr/></div>',
    );

    expect(out.html).toBe('<div><header class="hdr">Top</header></div>');
    expect(out.used).toEqual(['hdr']);
  });

  test('a paired reference works the same', () => {
    const out = run({ hdr: item({ html: '<header>Top</header>' }) }, '<div><x-hdr></x-hdr></div>');
    expect(out.html).toBe('<div><header>Top</header></div>');
  });

  test('several references, and the same one twice', () => {
    const out = run({ dot: item({ html: '<i class="dot"></i>' }) }, '<p><x-dot/> and <x-dot/></p>');

    expect(out.html).toBe('<p><i class="dot"></i> and <i class="dot"></i></p>');
    expect(out.used).toEqual(['dot']);
  });

  /* Between inline elements a newline IS a space. Adding or dropping one moves
     text, which is the whole reason the pixel gate can be trusted. */
  test('surrounding whitespace is untouched', () => {
    const out = run({ a: item({ html: '<b>x</b>' }) }, '<p>\n  before <x-a/> after\n</p>');
    expect(out.html).toBe('<p>\n  before <b>x</b> after\n</p>');
  });

  test('a component may use another component', () => {
    const out = run(
      {
        icon: item({ tier: 'element', html: '<i class="icon"></i>' }),
        chip: item({ html: '<span class="chip"><x-icon/>ok</span>' }),
      },
      '<p><x-chip/></p>',
    );

    expect(out.html).toBe('<p><span class="chip"><i class="icon"></i>ok</span></p>');
    expect(out.used.sort()).toEqual(['chip', 'icon']);
  });
});

describe('slots and fills', () => {
  const field = item({
    html:
      '<div class="f"><span class="f-label"><x-slot name="label">Label</x-slot></span>' +
      '<span class="f-val"><x-slot name="value"/></span></div>',
  });

  test('a fill lands in its slot', () => {
    const out = run(
      { field },
      '<x-field><x-fill slot="label">Budget</x-fill><x-fill slot="value">$1,240</x-fill></x-field>',
    );

    expect(out.html).toBe(
      '<div class="f"><span class="f-label">Budget</span><span class="f-val">$1,240</span></div>',
    );
  });

  test('a slot nobody filled keeps its default content', () => {
    const out = run({ field }, '<x-field><x-fill slot="value">$1</x-fill></x-field>');
    expect(out.html).toContain('<span class="f-label">Label</span>');
  });

  test('an unfilled slot with no default leaves nothing behind', () => {
    const out = run({ field }, '<x-field/>');
    expect(out.html).toBe(
      '<div class="f"><span class="f-label">Label</span><span class="f-val"></span></div>',
    );
  });

  test('children with no fill go to the default slot', () => {
    const out = run(
      { btn: item({ html: '<button class="b"><x-slot/></button>' }) },
      '<x-btn>Save</x-btn>',
    );
    expect(out.html).toBe('<button class="b">Save</button>');
  });

  /* The newline an author types between two fills is not content, and putting
     it in the default slot would add a space the original never had. */
  test('the whitespace between fills is not mistaken for content', () => {
    const out = run(
      { field },
      '<x-field>\n  <x-fill slot="label">A</x-fill>\n  <x-fill slot="value">B</x-fill>\n</x-field>',
    );

    expect(out.html).toBe(
      '<div class="f"><span class="f-label">A</span><span class="f-val">B</span></div>',
    );
  });

  test('a fill carries the caller’s markup whole, string keys and all', () => {
    const out = run(
      { btn: item({ html: '<button><x-slot/></button>' }) },
      '<x-btn><span data-t="home.save">Save</span></x-btn>',
    );

    expect(out.html).toBe('<button><span data-t="home.save">Save</span></button>');
  });

  test('a fill may itself contain a component', () => {
    const out = run(
      {
        icon: item({ tier: 'element', html: '<i></i>' }),
        btn: item({ html: '<button><x-slot/></button>' }),
      },
      '<x-btn><x-icon/>Go</x-btn>',
    );

    expect(out.html).toBe('<button><i></i>Go</button>');
  });

  test('components nest through slots', () => {
    const out = run(
      {
        inner: item({ tier: 'element', html: '<i><x-slot/></i>' }),
        outer: item({ html: '<b><x-slot/></b>' }),
      },
      '<x-outer><x-inner>deep</x-inner></x-outer>',
    );

    expect(out.html).toBe('<b><i>deep</i></b>');
  });
});

/* Extraction reads a family backwards: the screens say `dot dot-blue` and
   `dot dot-green`, and the component underneath them is `dot` plus a variant.
   `withoutClass` is how the base is found, so it has to undo exactly what
   `addClass` does — anything else and a correct extraction is refused. */
describe('taking a variant class back off', () => {
  test('undoes addClass', () => {
    for (const [html, extra] of [
      ['<span class="dot"></span>', 'dot-blue'],
      ['<span class="fchip fchip-doc"><svg/></span>', 'is-queued'],
      ['<button class="a b" aria-label="x">go</button>', 'is-on'],
      ['<div id="d">no class at all</div>', 'is-on'],
    ] as const) {
      expect(withoutClass(addClass(html, extra), extra)).toBe(html);
    }
  });

  test('leaves markup it was never added to alone', () => {
    expect(withoutClass('<span class="dot"></span>', 'is-on')).toBe('<span class="dot"></span>');
    expect(withoutClass('<span>plain</span>', 'is-on')).toBe('<span>plain</span>');
  });

  /* `class=""` would compose back as `class=" is-on"`, which is not what the
     screen said — and the byte comparison would refuse the extraction. */
  test('the last class takes the attribute with it', () => {
    expect(withoutClass('<span class="dot"></span>', 'dot')).toBe('<span></span>');
    expect(addClass('<span></span>', 'dot')).toBe('<span class="dot"></span>');
  });

  test('only the root, never a class inside it', () => {
    const html = '<div class="a is-on"><span class="is-on">x</span></div>';
    expect(withoutClass(html, 'is-on')).toBe('<div class="a"><span class="is-on">x</span></div>');
  });
});

describe('variants', () => {
  const field = item({
    html: '<div class="f"><x-slot/></div>',
    variants: {
      confirmed: { label: 'Confirmed', class: 'is-confirmed' },
      missing: { label: 'Missing', class: 'is-missing' },
    },
  });

  test('a variant adds its classes to the root', () => {
    const out = run({ field }, '<x-field variant="confirmed">x</x-field>');
    expect(out.html).toBe('<div class="f is-confirmed">x</div>');
  });

  /* Some families have no neutral member: `dot` on its own is an invisible
     circle nobody writes. The base markup still has to be neutral, because a
     variant adds a class and cannot take one away — so the item says which of
     its variants a bare reference means. */
  test('a bare reference means the default variant when there is one', () => {
    const dot = item({
      html: '<span class="dot"></span>',
      variants: { blue: { class: 'dot-blue' }, green: { class: 'dot-green' } },
      defaultVariant: 'blue',
    });

    expect(run({ dot }, '<x-dot/>').html).toBe('<span class="dot dot-blue"></span>');
    expect(run({ dot }, '<x-dot variant="green"/>').html).toBe(
      '<span class="dot dot-green"></span>',
    );
  });

  test('a default naming nothing leaves the base alone', () => {
    const dot = item({ html: '<span class="dot"></span>', defaultVariant: 'gone' });
    expect(run({ dot }, '<x-dot/>').html).toBe('<span class="dot"></span>');
  });

  test('no variant means the item as it is', () => {
    expect(run({ field }, '<x-field>x</x-field>').html).toBe('<div class="f">x</div>');
  });

  test('a root with no class attribute gains one', () => {
    const bare = item({ html: '<div><x-slot/></div>', variants: { on: { class: 'is-on' } } });
    expect(run({ bare }, '<x-bare variant="on">x</x-bare>').html).toBe(
      '<div class="is-on">x</div>',
    );
  });

  /* A screen cannot invent a variant. That is the point of naming them in the
     registry: the set is closed, and therefore enumerable. */
  test('an unknown variant is reported and the item still renders', () => {
    const out = run({ field }, '<x-field variant="confimed">x</x-field>');

    expect(out.problems[0]?.kind).toBe('unknown-variant');
    expect(out.problems[0]?.message).toContain('confirmed');
    expect(out.html).toBe('<div class="f">x</div>');
  });

  test('the variant reaches the root only, never inside', () => {
    const nested = item({
      html: '<div class="outer"><span class="inner">x</span></div>',
      variants: { on: { class: 'is-on' } },
    });

    expect(run({ nested }, '<x-nested variant="on"/>').html).toBe(
      '<div class="outer is-on"><span class="inner">x</span></div>',
    );
  });
});

/* A class is not always what tells two states apart. The design's own rule for
   a spent send button is `.comp-send[disabled]`, a ticked chip is `is-met` AND
   `aria-pressed="true"`, and a panel with a scrim behind it is different
   ELEMENTS. All three had to stay raw markup while a variant was only a class. */
describe('states a class cannot say', () => {
  const chip = item({
    html: '<button class="rchip">x</button>',
    variants: { met: { class: 'is-met', attrs: { 'aria-pressed': 'true' } } },
  });

  test('a variant sets attributes on the root, alongside its classes', () => {
    expect(run({ chip }, '<x-chip variant="met"/>').html).toBe(
      '<button aria-pressed="true" class="rchip is-met">x</button>',
    );
  });

  test('and leaves the base alone', () => {
    expect(run({ chip }, '<x-chip/>').html).toBe('<button class="rchip">x</button>');
  });

  /* `disabled`, not `disabled=""` — a design file has the bare form in it, and
     a screen composed from parts should read like one somebody wrote. */
  test('an empty value writes the bare attribute', () => {
    const send = item({
      html: '<button class="comp-send">go</button>',
      variants: { spent: { attrs: { disabled: '' } } },
    });

    expect(run({ send }, '<x-send variant="spent"/>').html).toBe(
      '<button disabled class="comp-send">go</button>',
    );
  });

  test('an attribute already on the root is replaced, not repeated', () => {
    const tab = item({
      html: '<button class="tab" aria-selected="false">x</button>',
      variants: { on: { attrs: { 'aria-selected': 'true' } } },
    });

    expect(run({ tab }, '<x-tab variant="on"/>').html).toBe(
      '<button class="tab" aria-selected="true">x</button>',
    );
  });

  test('a variant may bring markup of its own', () => {
    const panel = item({
      html: '<aside class="spec"><x-slot/></aside>',
      variants: {
        modal: { html: '<div class="scrim"></div><aside class="spec"><x-slot/></aside>' },
      },
    });

    expect(run({ panel }, '<x-panel variant="modal">body</x-panel>').html).toBe(
      '<div class="scrim"></div><aside class="spec">body</aside>',
    );
    expect(run({ panel }, '<x-panel>body</x-panel>').html).toBe('<aside class="spec">body</aside>');
  });

  /* Which is what keeps an override from becoming a second item: the state can
     differ in structure and still share the modifier. */
  test('an override still takes class and attrs on top', () => {
    const panel = item({
      html: '<aside class="spec"><x-slot/></aside>',
      variants: {
        modal: {
          html: '<aside class="spec"><x-slot/></aside>',
          class: 'is-over',
          attrs: { role: 'dialog' },
        },
      },
    });

    expect(run({ panel }, '<x-panel variant="modal">x</x-panel>').html).toBe(
      '<aside role="dialog" class="spec is-over">x</aside>',
    );
  });
});

describe('refusals', () => {
  test('an unknown item is reported and dropped, and the screen still renders', () => {
    const out = run({}, '<p>before<x-ghost/>after</p>');

    expect(out.problems[0]?.kind).toBe('unknown-item');
    expect(out.html).toBe('<p>beforeafter</p>');
  });

  /* A thing may only contain things simpler than itself. */
  test('a screen inside a component is refused', () => {
    const out = run(
      { page: item({ tier: 'screen', html: '<main>page</main>' }) },
      '<div><x-page/></div>',
    );

    expect(out.problems[0]?.kind).toBe('wrong-tier');
    expect(out.html).toBe('<div></div>');
  });

  test('a component of the same tier is refused', () => {
    const out = run({ sibling: item({ tier: 'screen', html: '<p>x</p>' }) }, '<x-sibling/>');
    expect(out.problems[0]?.kind).toBe('wrong-tier');
  });

  test('a cycle is caught rather than hanging', () => {
    const items = {
      a: item({ tier: 'container', html: '<a><x-b/></a>' }),
      b: item({ tier: 'component', html: '<b><x-a/></b>' }),
    };
    const out = run(items, '<x-a/>');

    expect(out.problems.some((p) => p.kind === 'cycle' || p.kind === 'wrong-tier')).toBe(true);
    expect(out.html).toContain('<a><b>');
  });

  test('an item that references itself is caught', () => {
    const out = run({ loop: item({ html: '<div><x-loop/></div>' }) }, '<x-loop/>');

    expect(out.problems.some((p) => p.kind === 'cycle')).toBe(true);
    expect(out.html).toBe('<div></div>');
  });
});

describe('awkward markup', () => {
  test('an attribute containing a greater-than sign does not cut the tag', () => {
    const out = run(
      { tip: item({ html: '<i title="a > b"><x-slot/></i>' }) },
      '<x-tip title="x > y">t</x-tip>',
    );

    expect(out.html).toBe('<i title="a > b">t</i>');
  });

  test('text that merely looks like a tag is left alone', () => {
    const html = '<p>write &lt;x-thing/&gt; to use it</p>';
    expect(run({}, html).html).toBe(html);
  });

  test('a component of the same name nested inside a fill', () => {
    const box = item({ html: '<div class="box"><x-slot/></div>' });
    const out = run({ box }, '<x-box><x-box>inner</x-box></x-box>');

    expect(out.html).toBe('<div class="box"><div class="box">inner</div></div>');
  });
});
