/* Moving a part's CSS out of the shared sheets it was imported in.
 *
 * The safety property is the one that matters: what a screen renders must not
 * change. The rules end up later in the cascade than they were, so anything
 * that relied on sheet order to beat an equally specific rule would move — and
 * this refuses the cases where that is possible rather than guessing.
 */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { apply, applyAll } from '../src/index';
import { attributeCss, dropEmptyBlocks, reWrap } from '../src/styles/attribute';
import { splitRules } from '../src/styles/rules';

const part = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'component',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function project(sheets: Record<string, string>, items: Record<string, Item>): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '',
      sheets,
      themes: { dark: { label: 'Dark', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items,
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('taking a part its own rules', () => {
  const doc = () =>
    project(
      {
        chat: '.thread { gap: 4px }\n.tag { color: red }\n.tag--dim { opacity: .5 }\n.row { x: 1 }',
      },
      { tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }) },
    );

  test('the rules it owns move onto it', () => {
    const plan = attributeCss(doc(), 'tag');
    const after = applyAll(doc(), plan.commands);

    expect(after.ok).toBe(true);
    expect(after.doc?.items.tag?.css).toContain('.tag { color: red }');
    expect(after.doc?.items.tag?.css).toContain('.tag--dim { opacity: .5 }');
  });

  test('and leave the sheet', () => {
    const after = applyAll(doc(), attributeCss(doc(), 'tag').commands);
    const chat = after.doc?.kit.sheets.chat ?? '';

    expect(chat).not.toContain('.tag');
    expect(chat).toContain('.thread');
    expect(chat).toContain('.row');
  });

  test('what somebody else owns is not touched', () => {
    const before = project(
      { chat: '.tag { color: red }\n.dot { color: blue }' },
      {
        tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }),
        dot: part({ html: '<i class="dot"></i>', sheets: ['chat'] }),
      },
    );
    const after = applyAll(before, attributeCss(before, 'tag').commands);

    expect(after.doc?.kit.sheets.chat).toContain('.dot { color: blue }');
    expect(after.doc?.items.dot?.css).toBeUndefined();
  });

  /* A part only takes from the sheets it actually links. A rule for `.tag`
     sitting in a sheet the tag never loads is somebody else's coincidence. */
  test('only from the sheets the part names', () => {
    const before = project(
      { chat: '.tag { color: red }', admin: '.tag { color: green }' },
      { tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }) },
    );
    const plan = attributeCss(before, 'tag');

    expect(plan.moved).toHaveLength(1);
    expect(plan.moved[0]?.sheet).toBe('chat');
  });

  test('nothing to move is not a change', () => {
    const before = project(
      { chat: '.other { x: 1 }' },
      { tag: part({ html: '', sheets: ['chat'] }) },
    );
    expect(attributeCss(before, 'tag').commands).toEqual([]);
  });

  test('existing css on the part is kept, not replaced', () => {
    const before = project(
      { chat: '.tag--dim { opacity: .5 }' },
      { tag: part({ html: '', css: '.tag { color: red }', sheets: ['chat'] }) },
    );
    const after = applyAll(before, attributeCss(before, 'tag').commands);

    expect(after.doc?.items.tag?.css).toContain('.tag { color: red }');
    expect(after.doc?.items.tag?.css).toContain('.tag--dim');
  });

  /* An import names its classes whatever it likes; the alias is how a part
     says which ones are its. */
  test('a part with an alias takes the classes the alias names', () => {
    const before = project(
      { chat: '.hdr { x: 1 }\n.hdr-back { y: 2 }\n.other { z: 3 }' },
      { header: part({ tier: 'layout', html: '', cssPrefix: 'hdr', sheets: ['chat'] }) },
    );
    const plan = attributeCss(before, 'header');
    const after = applyAll(before, plan.commands);

    expect(plan.moved).toHaveLength(2);
    expect(after.doc?.items.header?.cssPrefix).toBe('hdr');
    expect(after.doc?.kit.sheets.chat).toBe('.other { z: 3 }');
  });
});

/* The one that mattered. Moving CSS onto a part looked safe on paper and
   changed 224 renders out of 284 the first time it was tried against a real
   project: an imported design is raw markup writing `.dot` and `.tag` by hand,
   and a screen only receives a part's CSS if it COMPOSES that part. */
describe('a rule may not leave until nothing outside the part uses it', () => {
  const screen = (html: string): Item => ({
    tier: 'screen',
    html,
    props: {},
    fixtures: { default: { values: {} } },
    sheets: ['chat'],
  });

  test('a screen still writing the class by hand keeps the rule in the sheet', () => {
    const before = project(
      { chat: '.tag { color: red }' },
      {
        tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }),
        home: screen('<main><b class="tag">raw</b></main>'),
      },
    );
    const plan = attributeCss(before, 'tag');

    expect(plan.moved).toEqual([]);
    expect(plan.left[0]?.why).toBe('screens still use the class');
    expect(plan.left[0]?.screens).toEqual(['home']);
  });

  test('but once every screen composes the part, the rule may move', () => {
    const before = project(
      { chat: '.tag { color: red }' },
      {
        tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }),
        home: screen('<main><x-tag/></main>'),
      },
    );
    const plan = attributeCss(before, 'tag');
    const after = applyAll(before, plan.commands);

    expect(plan.moved).toHaveLength(1);
    expect(after.doc?.items.tag?.css).toContain('.tag { color: red }');
  });

  /* Per rule, not per part: a state nobody has hand-written yet can go even
     while the base class is still loose. */
  test('the check is per rule', () => {
    const before = project(
      { chat: '.tag { color: red }\n.tag--dim { opacity: .5 }' },
      {
        tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }),
        home: screen('<main><b class="tag">raw</b></main>'),
      },
    );
    const plan = attributeCss(before, 'tag');

    expect(plan.moved.map((m) => m.selector)).toEqual(['.tag--dim']);
    expect(plan.left.map((l) => l.selector)).toEqual(['.tag']);
  });

  test('a screen that composes the part through a container counts as composing it', () => {
    const before = project(
      { chat: '.tag { color: red }' },
      {
        tag: part({ html: '<b class="tag"></b>', sheets: ['chat'] }),
        bar: part({ tier: 'container', html: '<div class="bar"><x-tag/></div>', sheets: ['chat'] }),
        home: screen('<main><x-bar/></main>'),
      },
    );

    expect(attributeCss(before, 'tag').moved).toHaveLength(1);
  });
});

describe('what it refuses to decide', () => {
  test('a rule whose subject names two parts stays put', () => {
    const before = project(
      { chat: '.tag.dot { x: 1 }' },
      {
        tag: part({ html: '', sheets: ['chat'] }),
        dot: part({ html: '', sheets: ['chat'] }),
      },
    );
    const plan = attributeCss(before, 'tag');

    expect(plan.moved).toEqual([]);
    expect(plan.left[0]?.why).toBe('several owners');
  });

  /* `.tag .label` styles a label that lives inside a tag. The label is not
     extracted, so the rule is not the tag's to carry away. */
  test('a rule where the part is only the context is left behind', () => {
    const before = project(
      { chat: '.tag .label { x: 1 }' },
      { tag: part({ html: '', sheets: ['chat'] }) },
    );

    expect(attributeCss(before, 'tag').moved).toEqual([]);
  });

  test('a screen is not a part and takes nothing', () => {
    const before = project(
      { chat: '.home { x: 1 }' },
      { home: { ...part({ html: '' }), tier: 'screen', sheets: ['chat'] } },
    );

    expect(attributeCss(before, 'home').commands).toEqual([]);
  });
});

describe('conditions travel with the rule', () => {
  test('a rule inside a media query is re-wrapped in it', () => {
    const before = project(
      { chat: '@media (max-width: 700px) {\n  .tag { x: 1 }\n}' },
      { tag: part({ html: '', sheets: ['chat'] }) },
    );
    const after = applyAll(before, attributeCss(before, 'tag').commands);
    const css = after.doc?.items.tag?.css ?? '';

    expect(css).toContain('@media (max-width: 700px)');
    expect(css).toContain('.tag { x: 1 }');
    // and the emptied query is not left behind
    expect(after.doc?.kit.sheets.chat?.trim()).toBe('');
  });

  test('a query that still holds somebody else is kept', () => {
    const before = project(
      { chat: '@media print {\n  .tag { x: 1 }\n  .other { y: 2 }\n}' },
      { tag: part({ html: '', sheets: ['chat'] }) },
    );
    const after = applyAll(before, attributeCss(before, 'tag').commands);

    expect(after.doc?.kit.sheets.chat).toContain('@media print');
    expect(after.doc?.kit.sheets.chat).toContain('.other');
    expect(after.doc?.kit.sheets.chat).not.toContain('.tag');
  });

  test('nesting is rebuilt outermost first', () => {
    const [rule] = splitRules('@supports (x: 1) { @media print { .a { y: 2 } } }');
    const text = reWrap(rule as never);

    expect(text.indexOf('@supports')).toBeLessThan(text.indexOf('@media'));
    expect(text.indexOf('@media')).toBeLessThan(text.indexOf('.a'));
  });

  test('an empty block is dropped, one with a comment in it is not', () => {
    expect(dropEmptyBlocks('@media print {  }').trim()).toBe('');
    expect(dropEmptyBlocks('@media print { /* keep */ }')).toContain('keep');
  });
});

describe('undo', () => {
  test('puts the rules back in the sheet and takes them off the part', () => {
    const before = project(
      { chat: '.thread { gap: 4px }\n.tag { color: red }' },
      { tag: part({ html: '', sheets: ['chat'] }) },
    );
    const plan = attributeCss(before, 'tag');
    const after = applyAll(before, plan.commands);

    let back = after.doc as ProjectDoc;
    for (const step of after.inverse) back = (apply(back, step).doc ?? back) as ProjectDoc;

    expect(back.kit.sheets.chat).toBe(before.kit.sheets.chat);
    expect(back.items.tag?.css).toBeUndefined();
  });
});
