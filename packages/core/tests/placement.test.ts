/* Placement per viewport.
 *
 * Grid units were meant to make one arrangement correct at every size. They are
 * not, and the arithmetic says why: a column is a screen width plus a corridor
 * and a lane is a screen height plus its captions, so 390x844 -> 1440x900 is a
 * step of 570x994 becoming 1620x1050. Across, 2.84x. Down, 1.06x. A tidy grid
 * on the phone is three times as wide and the same height on the desktop.
 */

import { describe, expect, test } from 'bun:test';
import type { Flow, ProjectDoc } from '../src/index';
import { apply, arrange, placementOf, stepOf } from '../src/index';

const MOBILE = { id: 'mobile', label: 'M', device: 'mobile' as const, width: 390, height: 844 };
const DESKTOP = { id: 'desktop', label: 'D', device: 'desktop' as const, width: 1440, height: 900 };

const flow = (): Flow => ({
  nodes: {
    a: { screen: 'a', fixture: 'default', col: 0, lane: 0, groups: ['main'] },
    b: {
      screen: 'b',
      fixture: 'default',
      col: 1,
      lane: 0,
      groups: ['main'],
      cells: { desktop: { col: 0, lane: 1 } },
    },
  },
  edges: {},
  groups: [{ id: 'main', label: 'Main' }],
});

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
      themes: { dark: { label: 'Dark', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {
      a: {
        tier: 'screen',
        html: '<main></main>',
        props: {},
        fixtures: { default: { values: {} } },
      },
      b: {
        tier: 'screen',
        html: '<main></main>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: flow(),
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [MOBILE, DESKTOP],
  };
}

describe('the reason this exists', () => {
  test('the grid step is not uniform between viewports', () => {
    const phone = stepOf(MOBILE);
    const desk = stepOf(DESKTOP);

    expect(desk.x / phone.x).toBeCloseTo(2.84, 1);
    expect(desk.y / phone.y).toBeCloseTo(1.06, 1);
  });
});

describe('placementOf', () => {
  test('a viewport with its own placement gets it', () => {
    expect(placementOf(flow(), 'desktop')).toEqual({
      a: { col: 0, lane: 0 },
      b: { col: 0, lane: 1 },
    });
  });

  test('and every other viewport falls back to the shared one', () => {
    expect(placementOf(flow(), 'mobile')).toEqual({
      a: { col: 0, lane: 0 },
      b: { col: 1, lane: 0 },
    });
  });

  /* Everything that reads placement without saying which viewport — an
     importer, a test, a caller that predates this — must keep getting the
     shared answer rather than a random one. */
  test('asking for no viewport asks for the shared placement', () => {
    expect(placementOf(flow())).toEqual({ a: { col: 0, lane: 0 }, b: { col: 1, lane: 0 } });
  });
});

describe('arranging', () => {
  test('for one viewport, the others are left alone', () => {
    const r = apply(project(), { t: 'flow.arrange', viewport: 'desktop' });

    expect(r.ok).toBe(true);
    // the shared placement is untouched
    expect(r.doc?.flow.nodes.b?.col).toBe(1);
    expect(r.doc?.flow.nodes.b?.lane).toBe(0);
    // and the desktop one is what the graph says, whatever that is
    expect(r.doc?.flow.nodes.b?.cells?.desktop).toEqual(arrange(flow()).b as never);
  });

  test('a viewport nobody arranged still has no placement of its own', () => {
    const r = apply(project(), { t: 'flow.arrange', viewport: 'desktop' });

    expect(r.doc?.flow.nodes.b?.cells?.mobile).toBeUndefined();
  });

  /* "The way back from a mess" has to be a real reset: an override left
     standing would put the mess back the moment somebody switched size. */
  test('without a viewport it resets, overrides and all', () => {
    const r = apply(project(), { t: 'flow.arrange' });

    expect(r.doc?.flow.nodes.b?.cells).toBeUndefined();
  });

  test('and undo puts the override back', () => {
    const arranged = apply(project(), { t: 'flow.arrange' });
    const back = apply(arranged.doc as ProjectDoc, arranged.inverse[0] as never);

    expect(back.doc?.flow.nodes.b?.cells).toEqual({ desktop: { col: 0, lane: 1 } });
  });
});
