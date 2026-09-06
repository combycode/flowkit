/* Smoke tests for the schema's runtime surface. There is almost no runtime
 * yet — these exist so the gate is real from the first commit rather than a
 * script that passes because it runs nothing. */

import { describe, expect, test } from 'bun:test';
import type { Item, Tier } from '../src/index';
import { DEFAULT_VIEWPORTS, isOpaque, TIER_RANK } from '../src/index';

const item = (html: string): Item => ({
  tier: 'screen',
  html,
  props: {},
  fixtures: { default: { values: {} } },
});

describe('tier ranking', () => {
  /* A layout ranks BELOW a screen: a screen is the only thing nothing
     contains, and the first thing it contains is the shell it is poured
     into. */
  test('orders element → component → container → layout → screen', () => {
    const order: Tier[] = ['element', 'component', 'container', 'layout', 'screen'];
    const ranks = order.map((t) => TIER_RANK[t]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
  });
});

describe('isOpaque', () => {
  test('plain html is opaque — the phase-1 and import case', () => {
    expect(isOpaque(item('<header class="hdr"><h1>Orders</h1></header>'))).toBe(true);
  });

  test('any <x-*> child makes it composed', () => {
    expect(isOpaque(item('<div><x-button label="Save"/></div>'))).toBe(false);
  });

  test('is not fooled by markup that merely mentions one', () => {
    // A code sample or a description should not flip an item's status.
    expect(isOpaque(item('<p>use &lt;x-button&gt; here</p>'))).toBe(true);
  });

  test('matches regardless of case', () => {
    expect(isOpaque(item('<X-Button/>'))).toBe(false);
  });
});

describe('default viewports', () => {
  test('are the two sizes the STRAIW design is exported at', () => {
    expect(DEFAULT_VIEWPORTS.map((v) => [v.width, v.height])).toEqual([
      [390, 844],
      [1440, 900],
    ]);
  });

  test('have unique ids', () => {
    const ids = DEFAULT_VIEWPORTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
