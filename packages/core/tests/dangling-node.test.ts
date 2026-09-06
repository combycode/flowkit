/* validate must see a node pointing at a screen that is gone.
 *
 * This was the second half of the rename disaster: the references dangled, and
 * validate reported "No problems" over them, because it never checked node →
 * screen. A render of the screen looked fine (it addresses the item directly,
 * past the node), so both ordinary checks were green while every export came
 * out black.
 */

import { describe, expect, test } from 'bun:test';
import type { ProjectDoc } from '../src/index';
import { apply, validate } from '../src/index';

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
      home: {
        tier: 'screen',
        html: '<main></main>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: {
      nodes: { n1: { screen: 'home', fixture: 'default' } },
      edges: {},
      groups: [],
    },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

/** A doc with a node left pointing at a screen that no longer exists —
 *  reached by hand, since the command layer now refuses to create one. */
function withDangling(): ProjectDoc {
  const d = doc();
  d.flow.nodes.n1 = { screen: 'gone', fixture: 'default' };
  return d;
}

describe('a dangling node reference', () => {
  test('validate reports it — the thing it used to miss', () => {
    const found = validate(withDangling());
    const codes = found.map((f) => f.code);
    expect(codes).toContain('unknown-item');
    expect(found.some((f) => f.message.includes('gone'))).toBe(true);
  });

  test('a healthy document still reports nothing', () => {
    expect(validate(doc()).filter((f) => f.code === 'unknown-item')).toEqual([]);
  });

  /* The reason it is a warning and not an error: apply rejects a write whose
     result carries a rule error, so an error would lock a project that already
     has a dangling node — every fix would run the rule on the still-broken
     rest and be refused. A warning must NOT block an unrelated write. */
  test('it does not block writes on an already-broken document', () => {
    const r = apply(withDangling(), { t: 'project.rename', name: 'Renamed' });
    expect(r.ok).toBe(true);
    expect(r.doc?.name).toBe('Renamed');
  });

  test('repointing the node at a real screen clears it', () => {
    const fixed = apply(withDangling(), {
      t: 'node.update',
      id: 'n1',
      patch: { screen: 'home' },
    });
    expect(fixed.ok).toBe(true);
    expect(validate(fixed.doc as ProjectDoc).filter((f) => f.code === 'unknown-item')).toEqual([]);
  });
});
