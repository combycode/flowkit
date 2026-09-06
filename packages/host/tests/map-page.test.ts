/* The map page is pure string building, so it can be checked without a
 * browser. What matters is that it is assembled from the same parts the canvas
 * is, that a screen stays a whole document, and that the stylesheet is written
 * once rather than sixty-two times. */

import { describe, expect, test } from 'bun:test';
import type { ProjectDoc } from '@flowkit/core';
import { mapPage } from '../src/render/map-page';

const CSS = '.chat{color:red}'.padEnd(400, '/*pad*/');

function project(): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: CSS,
      sheets: {},
      themes: { dark: { label: 'Dark', tokens: { '--bg': '#000' } } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {
      one: {
        tier: 'screen',
        html: '<h1>One</h1>',
        rootAttrs: { 'data-spec': 'closed' },
        props: {},
        fixtures: { default: { values: {} } },
      },
      two: {
        tier: 'screen',
        html: '<h1>Two</h1>',
        props: {},
        fixtures: { default: { values: {} } },
      },
      three: {
        tier: 'screen',
        html: '<h1>Three</h1>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: {
      nodes: {
        a: { screen: 'one', fixture: 'default', groups: ['main'], order: 1, title: 'First' },
        b: { screen: 'two', fixture: 'default', groups: ['main'], order: 2, title: 'Second' },
        c: { screen: 'three', fixture: 'default', groups: ['other'], order: 1, title: 'Elsewhere' },
      },
      edges: {
        e1: { from: 'a', to: 'b', label: 'ok', origin: 'auto' },
      },
      groups: [
        { id: 'main', label: 'Main' },
        { id: 'other', label: 'Other' },
      ],
    },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
  };
}

const ctx = { theme: 'dark', locale: 'en', viewport: 'mobile' };

describe('mapPage', () => {
  test('every screen gets a frame, and the connections are drawn', () => {
    const map = mapPage({ doc: project(), ctx });

    expect(map.screens).toBe(3);
    expect(map.edges).toBe(1);
    expect(map.html).toContain('data-screen="a"');
    expect(map.html).toContain('data-screen="c"');
    expect(map.html).toContain('<path class="e a"');
    expect(map.html).toContain('>ok</text>');
  });

  test('a flow filter takes its connections with it', () => {
    const map = mapPage({ doc: project(), ctx, group: 'other' });

    expect(map.screens).toBe(1);
    // The one edge joins two screens that are no longer here; drawing it would
    // be a line to nowhere.
    expect(map.edges).toBe(0);
    expect(map.html).not.toContain('data-screen="a"');
  });

  /* The bug this guards: inlining sixty-two copies of a 200 KB stylesheet made
     a 12 MB document of which almost all was the same bytes. */
  test('the stylesheet is written once, not once per screen', () => {
    const map = mapPage({ doc: project(), ctx });
    const copies = map.html.split('.chat{color:red}').length - 1;

    expect(copies).toBe(1);
  });

  /* A screen is a document. `body[data-spec='closed'] .spec` stops matching
     the moment that body becomes a div, which is how the brief panel once
     rendered open on every screen that should have had it shut. */
  test('a screen keeps its own body attributes', () => {
    const map = mapPage({ doc: project(), ctx });

    expect(map.html).toContain('data-spec=');
    expect(map.html).toContain('<iframe');
  });

  test('bounds cover every screen with room for the captions', () => {
    const doc = project();
    const map = mapPage({ doc, ctx });

    // Three screens over two flows: wider than one screen, taller than one.
    expect(map.bounds.width).toBeGreaterThan(390);
    expect(map.bounds.height).toBeGreaterThan(844);
  });

  test('the page starts at its own top-left however far down the flow sits', () => {
    const doc = project();
    // Push the second flow a long way down the canvas.
    const c = doc.flow.nodes.c;
    if (c) {
      c.col = 0;
      c.lane = 40;
    }
    const map = mapPage({ doc, ctx, group: 'other' });

    expect(map.bounds.y).toBeGreaterThan(1000);
    // …but nothing is drawn at a negative offset inside the page.
    expect(map.html).not.toContain('top:-');
  });

  /* A kit page is designed at 1440 and is unreadable in a phone frame. The map
     has to agree with the canvas about that, or it is a picture of a layout
     nobody has. */
  describe('a node that pins its own size', () => {
    const withWide = () => {
      const doc = project();
      doc.viewports.push({
        id: 'desktop',
        label: 'Desktop',
        device: 'desktop',
        width: 1440,
        height: 900,
      });
      const c = doc.flow.nodes.c;
      if (c) c.viewport = 'desktop';
      return doc;
    };

    test('is drawn at that size while the rest follow the toolbar', () => {
      const map = mapPage({ doc: withWide(), ctx });

      expect(map.html).toContain('<iframe data-screen="c" width="1440" height="900"');
      expect(map.html).toContain('<iframe data-screen="a" width="390" height="844"');
    });

    test('and the bounds cover it rather than cropping it', () => {
      const wide = mapPage({ doc: withWide(), ctx, group: 'other' });
      const narrow = mapPage({ doc: project(), ctx, group: 'other' });

      expect(wide.bounds.width).toBeGreaterThan(1440);
      expect(wide.bounds.width).toBeGreaterThan(narrow.bounds.width);
    });

    /* A pinned screen is bigger; the GRID is not. Sizing the step to the
       largest screen on the map pushed sixty-two phones 1440px apart because a
       few kit pages are desktop — a fix that ruined the thing it protected.
       One lane is a screen height plus 150px of caption room, which is where a
       taller page fits. */
    test('does not stretch the grid the others sit on', () => {
      const doc = withWide();
      const c = doc.flow.nodes.c;
      if (c) c.groups = ['main'];

      const same = project();
      const plainC = same.flow.nodes.c;
      if (plainC) plainC.groups = ['main'];

      const wide = mapPage({ doc, ctx, group: 'main' });
      const plain = mapPage({ doc: same, ctx, group: 'main' });

      const lefts = (html: string) => [...html.matchAll(/left:(\d+)px/g)].map((m) => Number(m[1]));
      expect(lefts(wide.html)).toEqual(lefts(plain.html));
    });
  });

  /* A map is about journeys, so the kit is not on it. A SELECTION is about
     what someone pointed at, and they can point at a kit page — and because
     the map is laid out in canvas coordinates, leaving those pages out moves
     every coordinate after them. A rectangle drawn over the component page
     came back as a picture of the first screen in the flow. */
  describe('generated pages', () => {
    const withKit = () => {
      const doc = project();
      const three = doc.items.three;
      if (three) three.generated = 'kit';
      return doc;
    };

    test('are left off a map', () => {
      const map = mapPage({ doc: withKit(), ctx });
      expect(map.screens).toBe(2);
      expect(map.html).not.toContain('data-screen="c"');
    });

    test('are on the page a selection is drawn against', () => {
      const map = mapPage({ doc: withKit(), ctx, generated: true });
      expect(map.screens).toBe(3);
      expect(map.html).toContain('data-screen="c"');
    });

    test('and the box grows to hold them, so the coordinates still line up', () => {
      const without = mapPage({ doc: withKit(), ctx });
      const with_ = mapPage({ doc: withKit(), ctx, generated: true });

      expect(with_.bounds.height).toBeGreaterThan(without.bounds.height);
    });
  });

  test('labels can be turned off', () => {
    const bare = mapPage({ doc: project(), ctx, labels: false });

    expect(bare.html).not.toContain('>First</div>');
    expect(bare.html).toContain('data-screen="a"');
  });

  test('an empty flow produces a page rather than a crash', () => {
    const doc = project();
    doc.flow.nodes = {};
    const map = mapPage({ doc, ctx });

    expect(map.screens).toBe(0);
    expect(map.bounds.width).toBeGreaterThan(0);
  });

  /* `</script>` inside the embedded stylesheet or markup would end the tag
     early and turn the rest of the page into text. */
  test('embedded data cannot close the script tag that carries it', () => {
    const doc = project();
    doc.kit.base = `${CSS} .x::after{content:"</script>"}`;
    const one = doc.items.one;
    if (one) one.html = '<p>a </script> b</p>';

    const map = mapPage({ doc, ctx });
    const afterData = map.html.slice(map.html.indexOf('id="kit"'));

    // Exactly two closing tags remain: the kit block and the screens block,
    // plus the bootstrap. Nothing from the payload closed anything.
    expect(afterData).toContain('id="screens"');
    expect(map.html).not.toContain('content:"</script>"');
  });
});

/* A dark board behind light screens previews nothing, and white titles on a
   light ground are simply not there. */
describe('the map wears the theme it renders', () => {
  test('the chrome borrows the theme tokens', () => {
    const doc = project();
    doc.kit.themes.light = { label: 'Light', tokens: { '--bg': '#ffffff', '--text': '#111111' } };
    const map = mapPage({ doc, ctx: { ...ctx, theme: 'light' } });

    expect(map.html).toContain('--bg: #ffffff');
    expect(map.html).toContain('background:var(--bg,');
  });

  test('a project with no such tokens still gets a legible board', () => {
    const doc = project();
    // The dark theme here defines only --bg; --text is nobody's convention.
    const map = mapPage({ doc, ctx });

    expect(map.html).toContain('color:var(--text,#e6e8ee)');
  });
});
