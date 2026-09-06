/* A screen that is still a picture.
 *
 * The behaviour that matters is the ORDER: markup wins the moment there is any,
 * so converting a mockup is write, render, correct — with the picture behind
 * you rather than in front of it. Get that backwards and somebody writes markup,
 * renders, sees the mockup, and has no way to tell why.
 */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { apply, composeDocument, validate } from '../src/index';

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'screen',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function project(over: Partial<Item> = {}): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '.app { color: red }',
      sheets: {},
      themes: { dark: { label: 'Dark', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: { home: item({ html: '', image: 'shot', ...over }) },
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: { shot: { kind: 'image', mime: 'image/png', bytes: PIXEL, label: 'home.png' } },
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

const render = (doc: ProjectDoc) =>
  composeDocument({
    doc,
    item: 'home',
    ctx: { theme: 'dark', locale: 'en', viewport: 'mobile' },
  }).html;

describe('rendering a mockup', () => {
  test('a screen with a picture and no markup renders the picture', () => {
    const html = render(project());

    expect(html).toContain(`src="data:image/png;base64,${PIXEL}"`);
    expect(html).toContain('data-df-mockup="shot"');
  });

  /* Its own stylesheet, not the design's: none of the design's rules apply to
     an <img>, and loading them would put the whole kit behind a screenshot. */
  test('and does not carry the design’s stylesheet behind it', () => {
    expect(render(project())).not.toContain('.app { color: red }');
  });

  test('markup wins the moment there is any', () => {
    const html = render(project({ html: '<main>real</main>' }));

    expect(html).toContain('<main>real</main>');
    expect(html).not.toContain('data:image/png');
  });

  /* A missing asset must not render a broken img tag with the id in it. */
  test('a picture that is not in the document falls through to the markup path', () => {
    const doc = project();
    doc.items.home = item({ html: '', image: 'gone' });

    expect(render(doc)).not.toContain('data:image/png');
  });
});

describe('stranded-mockup', () => {
  const problems = (doc: ProjectDoc) => validate(doc).filter((p) => p.code === 'stranded-mockup');

  test('says nothing about a mockup that is doing its job', () => {
    expect(problems(project())).toEqual([]);
  });

  test('reports the picture left behind once markup exists', () => {
    const found = problems(project({ html: '<main>real</main>' }));

    expect(found[0]?.message).toContain('no longer drawn');
    expect(found[0]?.severity).toBe('warning');
  });

  test('and a picture no screen uses at all', () => {
    const doc = project();
    doc.items.home = item({ html: '<main>real</main>' }); // no image field

    expect(problems(doc)[0]?.message).toContain('no screen uses');
  });

  /* Deleting a screen deliberately leaves its picture: two screens can share
     one, and a cascade is how somebody loses the other. */
  test('deleting the screen leaves the picture, and it is reported', () => {
    const r = apply(project(), { t: 'item.delete', name: 'home' });

    expect(r.doc?.assets.shot).toBeDefined();
    expect(problems(r.doc as ProjectDoc)[0]?.message).toContain('no screen uses');
  });
});

describe('setting and clearing', () => {
  test('a picture can be taken away, leaving an ordinary screen', () => {
    const r = apply(project(), { t: 'item.setImage', name: 'home', asset: null });

    expect(r.doc?.items.home?.image).toBeUndefined();
  });

  test('and put back by undo', () => {
    const cleared = apply(project(), { t: 'item.setImage', name: 'home', asset: null });
    const back = apply(cleared.doc as ProjectDoc, cleared.inverse[0] as never);

    expect(back.doc?.items.home?.image).toBe('shot');
  });
});
