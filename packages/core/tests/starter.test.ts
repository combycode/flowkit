/* The starter is the first thing anyone sees and the example every later
 * screen gets modelled on. If it breaks its own rules, every project built
 * from it inherits that. */

import { describe, expect, test } from 'bun:test';
import type { ProjectDoc } from '../src/index';
import { blankContent, DEFAULT_VIEWPORTS, KITS, starterContent, validate } from '../src/index';

const asProject = (content: ReturnType<typeof starterContent>): ProjectDoc => ({
  schema: 1,
  id: 'p',
  name: 'P',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  kit: content.kit,
  items: content.items,
  flow: content.flow,
  strings: { defaultLocale: 'en', locales: content.locales },
  assets: {},
  viewports: DEFAULT_VIEWPORTS,
});

describe('the starter kit', () => {
  /* Whatever else it is, it has to be a project this codebase considers
     valid — otherwise `validate` greets everyone with complaints about the
     thing we handed them. */
  test('it passes our own validator', () => {
    const problems = validate(asProject(starterContent()));
    const errors = problems.filter((p) => p.severity === 'error');

    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('it opens with screens on the canvas and connections between them', () => {
    const { items, flow } = starterContent();

    expect(Object.keys(items).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(flow.nodes)).toEqual(Object.keys(items));
    expect(Object.keys(flow.edges).length).toBeGreaterThan(0);
  });

  test('every connection joins screens that exist', () => {
    const { flow } = starterContent();

    for (const edge of Object.values(flow.edges)) {
      expect(flow.nodes[edge.from]).toBeDefined();
      expect(flow.nodes[edge.to]).toBeDefined();
    }
  });

  /* A token defined in one theme and not the other is the most common theming
     bug there is, and the schema exists partly to make it checkable. */
  test('the themes define exactly the same tokens', () => {
    const themes = Object.values(starterContent().kit.themes);
    const keys = themes.map((t) => Object.keys(t.tokens).sort());

    for (const set of keys) expect(set).toEqual(keys[0] as string[]);
    expect(keys[0]?.length).toBeGreaterThan(20);
  });

  /* The screens are the worked example for how text is written. If they name
     keys that do not exist, the example teaches the wrong habit — and the
     second language is broken before anyone adds one. */
  test('every string key used in the markup has a value', () => {
    const { items, locales } = starterContent();
    const entries = locales.en?.entries ?? {};

    for (const [name, item] of Object.entries(items)) {
      for (const match of item.html.matchAll(/data-t="([^"]+)"/g)) {
        for (const key of (match[1] ?? '').split('|')) {
          expect({ screen: name, key, has: key in entries }).toEqual({
            screen: name,
            key,
            has: true,
          });
        }
      }
    }
  });

  test('nothing is translated that nobody wrote', () => {
    const { items, locales } = starterContent();
    const used = new Set<string>();
    for (const item of Object.values(items)) {
      for (const match of item.html.matchAll(/data-t="([^"]+)"/g)) {
        for (const key of (match[1] ?? '').split('|')) used.add(key);
      }
    }

    for (const key of Object.keys(locales.en?.entries ?? {})) {
      expect({ key, used: used.has(key) }).toEqual({ key, used: true });
    }
  });

  test('screens name a stylesheet the kit actually has', () => {
    const { items, kit } = starterContent();

    for (const item of Object.values(items)) {
      for (const sheet of item.sheets ?? []) {
        expect(Object.keys(kit.sheets)).toContain(sheet);
      }
    }
  });

  /* The house style belongs to components that are not items yet. Putting it
     on one screen would be a lie about who owns it. */
  test('the house style is a shared sheet, not one screen’s CSS', () => {
    const { items, kit } = starterContent();

    expect(kit.sheets.ui).toContain('.button');
    for (const item of Object.values(items)) expect(item.css ?? '').toBe('');
  });

  test('it needs no network: no webfonts, no assets', () => {
    expect(starterContent().kit.fonts).toEqual([]);
  });
});

describe('the blank kit', () => {
  test('it has the tokens and nothing else', () => {
    const { items, flow, kit } = blankContent();

    expect(items).toEqual({});
    expect(flow.nodes).toEqual({});
    expect(Object.keys(kit.themes.dark?.tokens ?? {}).length).toBeGreaterThan(20);
  });

  test('it is a valid project too', () => {
    expect(validate(asProject(blankContent()))).toEqual([]);
  });
});

describe('the catalogue', () => {
  test('every kit builds something valid', () => {
    for (const [id, entry] of Object.entries(KITS)) {
      const problems = validate(asProject(entry.build()));
      expect({ id, problems }).toEqual({ id, problems: [] });
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.describe.length).toBeGreaterThan(0);
    }
  });
});
