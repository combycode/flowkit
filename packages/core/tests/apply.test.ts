import { beforeEach, describe, expect, test } from 'bun:test';
import type { Command, ProjectDoc } from '../src/index';
import { apply, applyAll, NONE, validate } from '../src/index';

function fresh(): ProjectDoc {
  return {
    schema: 1,
    id: 't',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    kit: {
      preset: 'none',
      base: '',
      sheets: {},
      themes: {
        dark: { label: 'Dark', tokens: { '--bg': '#000', '--text': '#fff' } },
        light: { label: 'Light', tokens: { '--bg': '#fff', '--text': '#000' } },
      },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {
      auth: {
        tier: 'screen',
        html: '<h1 data-t="auth.sign-in">Sign in</h1>',
        props: {},
        fixtures: { default: { values: {} } },
      },
      button: {
        tier: 'element',
        html: '<button>x</button>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: {
      nodes: { n1: { screen: 'auth', fixture: 'default', col: 0, lane: 0 } },
      edges: {},
      groups: [{ id: 'main', label: 'Main' }],
    },
    strings: {
      defaultLocale: 'en',
      locales: { en: { label: 'English', entries: { 'auth.sign-in': 'Sign in' } } },
    },
    assets: {},
    viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
  };
}

let doc: ProjectDoc;
beforeEach(() => {
  doc = fresh();
});

const ok = (cmd: Command, d = doc) => {
  const r = apply(d, cmd, { rules: NONE.rules });
  if (!r.ok || !r.doc) throw new Error(`expected ok, got: ${JSON.stringify(r.diagnostics)}`);
  return r;
};

describe('a default variant', () => {
  const withDot = (): ProjectDoc => {
    const made = applyAll(doc, [
      { t: 'item.create', name: 'dot', tier: 'element', html: '<span class="dot"></span>' },
      { t: 'item.setVariant', name: 'dot', variant: 'blue', value: { class: 'dot-blue' } },
    ]);
    if (!made.ok || !made.doc) throw new Error(JSON.stringify(made.diagnostics));
    return made.doc;
  };

  test('names one of the item’s own variants', () => {
    const out = ok({ t: 'item.setDefaultVariant', name: 'dot', variant: 'blue' }, withDot());
    expect(out.doc?.items.dot?.defaultVariant).toBe('blue');
  });

  /* Otherwise every bare reference in the design names nothing, and the only
     symptom is a component that quietly renders without its colour. */
  test('one it does not declare is refused, and says what there is', () => {
    const out = apply(withDot(), { t: 'item.setDefaultVariant', name: 'dot', variant: 'blu' });
    expect(out.ok).toBe(false);
    expect(out.diagnostics[0]?.code).toBe('unknown-variant');
    expect(out.diagnostics[0]?.available).toEqual(['blue']);
  });

  test('deleting the variant it points at takes the default with it', () => {
    const withDefault = ok(
      { t: 'item.setDefaultVariant', name: 'dot', variant: 'blue' },
      withDot(),
    );
    const after = ok({ t: 'item.deleteVariant', name: 'dot', variant: 'blue' }, withDefault.doc);

    expect(after.doc?.items.dot?.defaultVariant).toBeUndefined();
  });

  test('null puts the bare reference back to the base', () => {
    const withDefault = ok(
      { t: 'item.setDefaultVariant', name: 'dot', variant: 'blue' },
      withDot(),
    );
    const after = ok({ t: 'item.setDefaultVariant', name: 'dot', variant: null }, withDefault.doc);

    expect(after.doc?.items.dot?.defaultVariant).toBeUndefined();
  });
});

describe('apply — the contract', () => {
  test('a rejected command changes nothing at all', () => {
    const before = JSON.stringify(doc);
    const r = apply(doc, { t: 'node.delete', id: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.doc).toBeUndefined();
    expect(JSON.stringify(doc)).toBe(before); // input untouched
  });

  test('never mutates the document it is given', () => {
    const before = JSON.stringify(doc);
    ok({ t: 'project.rename', name: 'Renamed' });
    expect(JSON.stringify(doc)).toBe(before);
  });

  test('routes by domain and reports an unhandled command', () => {
    const r = apply(doc, { t: 'nope.thing' } as unknown as Command);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.message).toContain('No reducer handles');
  });

  test('stamps updatedAt from the injected clock', () => {
    const r = apply(
      doc,
      { t: 'project.rename', name: 'X' },
      { rules: NONE.rules, now: () => 'LATER' },
    );
    expect(r.doc?.updatedAt).toBe('LATER');
    expect(r.doc?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('diagnostics teach', () => {
  test('an unknown reference names the nearest valid alternative', () => {
    const r = apply(doc, { t: 'item.setHtml', name: 'buton', html: 'x' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.suggestion).toBe('button');
    expect(r.diagnostics[0]?.message).toContain('Did you mean "button"?');
  });

  test('and lists what would have been accepted', () => {
    const r = apply(doc, { t: 'item.setHtml', name: 'zzz', html: 'x' });
    expect(r.diagnostics[0]?.available).toEqual(['auth', 'button']);
  });

  test('a node must point at a screen, not any item', () => {
    const r = apply(doc, {
      t: 'node.add',
      node: { screen: 'button', fixture: 'default', col: 0, lane: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('wrong-tier');
    expect(r.diagnostics[0]?.available).toEqual(['auth']);
  });
});

describe('referential integrity', () => {
  test('an item still used by a node cannot be deleted', () => {
    const r = apply(doc, { t: 'item.delete', name: 'auth' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('in-use');
    expect(r.diagnostics[0]?.available).toEqual(['n1']);
  });

  test('deleting a node takes its edges with it', () => {
    const two = ok({
      t: 'node.add',
      id: 'n2',
      node: { screen: 'auth', fixture: 'default', col: 1, lane: 0 },
    }).doc!;
    const linked = ok({ t: 'edge.connect', id: 'e1', from: 'n1', to: 'n2' }, two).doc!;
    expect(Object.keys(linked.flow.edges)).toEqual(['e1']);

    const pruned = ok({ t: 'node.delete', id: 'n2' }, linked).doc!;
    expect(pruned.flow.edges).toEqual({}); // no dangling edge left behind
  });

  test('deleting a group untags the nodes that referenced it', () => {
    const tagged = ok({ t: 'node.update', id: 'n1', patch: { groups: ['main'] } }).doc!;
    const gone = ok({ t: 'group.delete', id: 'main' }, tagged).doc!;
    expect(gone.flow.nodes.n1?.groups).toEqual([]);
    expect(gone.flow.groups).toEqual([]);
  });

  test('the default locale cannot be deleted — its text is the source', () => {
    const r = apply(doc, { t: 'locale.delete', id: 'en' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.message).toContain('default locale');
  });

  test('the last theme cannot be deleted', () => {
    const one = ok({ t: 'theme.delete', id: 'light' }).doc!;
    const r = apply(one, { t: 'theme.delete', id: 'dark' });
    expect(r.ok).toBe(false);
  });
});

describe('undo — every command returns its inverse', () => {
  const roundTrip = (cmd: Command) => {
    const before = JSON.stringify(doc);
    const applied = ok(cmd);
    expect(JSON.stringify(applied.doc)).not.toBe(before);
    const undone = applyAll(applied.doc!, applied.inverse, { rules: NONE.rules });
    expect(undone.ok).toBe(true);
    return JSON.stringify(undone.doc);
  };

  test('item.setHtml', () => {
    expect(roundTrip({ t: 'item.setHtml', name: 'auth', html: '<p>new</p>' })).toBe(
      JSON.stringify(doc),
    );
  });

  test('item.delete restores the whole item', () => {
    const noNode = ok({ t: 'node.delete', id: 'n1' }).doc!;
    const deleted = ok({ t: 'item.delete', name: 'auth' }, noNode);
    const back = applyAll(deleted.doc!, deleted.inverse, { rules: NONE.rules });
    expect(back.doc?.items.auth).toEqual(noNode.items.auth!);
  });

  test('node.update', () => {
    expect(roundTrip({ t: 'node.update', id: 'n1', patch: { col: 9.5, title: 'moved' } })).toBe(
      JSON.stringify(doc),
    );
  });

  test('theme.setToken on a token that did not exist restores its absence', () => {
    const added = ok({ t: 'theme.setToken', theme: 'dark', token: '--new', value: '#123' });
    expect(added.doc?.kit.themes.dark?.tokens['--new']).toBe('#123');
    const undone = applyAll(added.doc!, added.inverse, { rules: NONE.rules });
    expect(undone.doc?.kit.themes.dark?.tokens['--new']).toBeUndefined();
  });

  test('strings.set merges, and undo restores the previous entries exactly', () => {
    const set = ok({ t: 'strings.set', locale: 'en', entries: { extra: 'x' } });
    expect(set.doc?.strings.locales.en?.entries).toEqual({ 'auth.sign-in': 'Sign in', extra: 'x' });
    const undone = applyAll(set.doc!, set.inverse, { rules: NONE.rules });
    expect(undone.doc?.strings.locales.en?.entries).toEqual({ 'auth.sign-in': 'Sign in' });
  });
});

describe('applyAll is all-or-nothing', () => {
  test('a failure part way through commits nothing', () => {
    const before = JSON.stringify(doc);
    const r = applyAll(doc, [
      { t: 'project.rename', name: 'Half' },
      { t: 'node.delete', id: 'nope' }, // fails
    ]);
    expect(r.ok).toBe(false);
    expect(r.doc).toBeUndefined();
    expect(JSON.stringify(doc)).toBe(before);
  });

  test('undo of a sequence runs backwards', () => {
    const r = applyAll(
      doc,
      [
        { t: 'item.create', name: 'card', tier: 'component' },
        { t: 'item.setHtml', name: 'card', html: '<div>c</div>' },
      ],
      { rules: NONE.rules },
    );
    expect(r.ok).toBe(true);
    const undone = applyAll(r.doc!, r.inverse, { rules: NONE.rules });
    expect(undone.doc?.items.card).toBeUndefined();
  });
});

describe('rules run over the resulting document', () => {
  test('an unknown token is rejected wherever it comes from', () => {
    const r = apply(doc, {
      t: 'item.setCss',
      name: 'button',
      css: '.button { color: var(--nope); }',
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'unknown-token')).toBe(true);
  });

  test('a known token is fine', () => {
    const r = apply(doc, {
      t: 'item.setCss',
      name: 'button',
      css: '.button { color: var(--text); }',
    });
    expect(r.ok).toBe(true);
  });

  test('a hardcoded colour warns but does not block the write', () => {
    const r = apply(doc, { t: 'item.setCss', name: 'button', css: '.button { color: #ff0000; }' });
    expect(r.ok).toBe(true);
    const warning = r.diagnostics.find((d) => d.code === 'hardcoded-color');
    expect(warning?.severity).toBe('warning');
    expect(warning?.line).toBe(1);
  });

  /* Prose about a colour is not a colour. The status element's CSS explains in
     a comment which literal rgba() its variant-bound pip replaced, and saying so
     was reported as the very thing it had removed. */
  test('a colour named in a COMMENT is prose, not a violation', () => {
    const r = apply(doc, {
      t: 'item.setCss',
      name: 'button',
      css: '/* was #ff0000, now the token */\n.button { color: var(--text); }',
    });
    expect(r.diagnostics.some((d) => d.code === 'hardcoded-color')).toBe(false);
  });

  test('and a token named in a comment is not a use of one', () => {
    const r = apply(doc, {
      t: 'item.setCss',
      name: 'button',
      css: '/* not var(--never-defined) any more */\n.button { color: var(--text); }',
    });
    expect(r.diagnostics.some((d) => d.code === 'unknown-token')).toBe(false);
  });

  /* Blanking a comment keeps its length, so what follows still reports where it
     actually is. */
  test('a violation after a comment still reports its own line', () => {
    const r = apply(doc, {
      t: 'item.setCss',
      name: 'button',
      css: '/* two\n   lines */\n.button { color: #ff0000; }',
    });
    expect(r.diagnostics.find((d) => d.code === 'hardcoded-color')?.line).toBe(3);
  });

  test('a literal in a custom-property DECLARATION is the token itself, not a violation', () => {
    const r = apply(doc, {
      t: 'item.setCss',
      name: 'button',
      css: '.button { --local: #ff0000; }',
    });
    expect(r.diagnostics.some((d) => d.code === 'hardcoded-color')).toBe(false);
  });

  test('lenient reports violations without rejecting', () => {
    const r = apply(
      doc,
      { t: 'item.setCss', name: 'button', css: '.button { color: var(--nope); }' },
      { lenient: true },
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.code === 'unknown-token')).toBe(true);
  });

  test('a token missing from one theme is reported', () => {
    const r = apply(doc, {
      t: 'theme.setToken',
      theme: 'dark',
      token: '--only-dark',
      value: '#111',
    });
    expect(r.ok).toBe(true);
    const found = r.diagnostics.find((d) => d.code === 'token-not-in-all-themes');
    expect(found?.message).toContain('light');
  });
});

describe('validate', () => {
  test('a clean document has no errors', () => {
    expect(validate(doc).filter((d) => d.severity === 'error')).toEqual([]);
  });

  test('text with no key is reported', () => {
    const r = apply(doc, { t: 'item.setHtml', name: 'auth', html: '<h1>Unkeyed</h1>' });
    expect(r.diagnostics.some((d) => d.code === 'untranslated-text')).toBe(true);
  });
});

/* `flow.arrange` — the way back from a mess.
 *
 * Hand placement wins everywhere else, so there has to be one command that
 * deliberately discards it. The thing that makes it safe is that it undoes in
 * one step, including for screens that had never been placed at all. */
describe('flow.arrange', () => {
  const laid = (): ProjectDoc => {
    const base = ok({
      t: 'node.add',
      id: 'n2',
      node: { screen: 'auth', fixture: 'default', order: 2, groups: ['main'] },
    }).doc!;
    const grouped = ok({ t: 'node.update', id: 'n1', patch: { groups: ['main'], order: 1 } }, base)
      .doc!;
    return ok({ t: 'edge.connect', id: 'e1', from: 'n1', to: 'n2' }, grouped).doc!;
  };

  test('places connected screens along the flow', () => {
    const after = ok({ t: 'flow.arrange' }, laid()).doc!;

    expect(after.flow.nodes.n1?.col).toBe(0);
    expect(after.flow.nodes.n2?.col).toBe(1);
    expect(after.flow.nodes.n2?.lane).toBe(after.flow.nodes.n1?.lane);
  });

  test('overrides a placement someone made by hand', () => {
    const moved = ok({ t: 'node.update', id: 'n2', patch: { col: 9, lane: 4 } }, laid()).doc!;
    const after = ok({ t: 'flow.arrange' }, moved).doc!;

    expect(after.flow.nodes.n2?.col).toBe(1);
    expect(after.flow.nodes.n2?.lane).toBe(0);
  });

  /* The bug this is here for: undoing an arrange must put a never-placed node
     back to never-placed. A patch that merges would leave it at column 0,
     which is a placement — and then the canvas stops arranging it. */
  test('undo restores an unplaced screen to unplaced', () => {
    const before = laid();
    const applied = apply(before, { t: 'flow.arrange' }, { rules: NONE.rules });
    const undone = applyAll(applied.doc!, applied.inverse, { rules: NONE.rules });

    expect(undone.ok).toBe(true);
    // n2 was never placed; n1 starts at 0,0 in the fixture and goes back there.
    expect(undone.doc?.flow.nodes.n2?.col).toBeUndefined();
    expect(undone.doc?.flow.nodes.n2?.lane).toBeUndefined();
    expect(JSON.stringify(undone.doc)).toBe(JSON.stringify(before));
  });

  test('scoped to one flow, it leaves the rest of the canvas alone', () => {
    const withGroup = ok({ t: 'group.set', group: { id: 'other', label: 'Other' } }, laid()).doc!;
    const two = ok(
      {
        t: 'node.add',
        id: 'n3',
        node: { screen: 'auth', fixture: 'default', groups: ['other'], col: 7, lane: 7 },
      },
      withGroup,
    ).doc!;

    const after = ok({ t: 'flow.arrange', group: 'main' }, two).doc!;

    expect(after.flow.nodes.n3?.col).toBe(7);
    expect(after.flow.nodes.n1?.col).toBe(0);
  });

  test('an unknown flow is refused, and says which ones exist', () => {
    const r = apply(laid(), { t: 'flow.arrange', group: 'nope' }, { rules: NONE.rules });

    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('unknown-group');
  });
});

describe('connections', () => {
  test('a connection someone made is authored, not a guess', () => {
    const two = ok({
      t: 'node.add',
      id: 'n2',
      node: { screen: 'auth', fixture: 'default' },
    }).doc!;
    const linked = ok({ t: 'edge.connect', id: 'e1', from: 'n1', to: 'n2' }, two).doc!;

    // The canvas draws 'auto' provisionally; anything asserted must not be
    // shown with the same weight as the importer's guesswork.
    expect(linked.flow.edges.e1?.origin).toBe('authored');
  });

  test('disconnecting is undoable, label and all', () => {
    const two = ok({
      t: 'node.add',
      id: 'n2',
      node: { screen: 'auth', fixture: 'default' },
    }).doc!;
    const linked = ok({ t: 'edge.connect', id: 'e1', from: 'n1', to: 'n2', label: 'ok' }, two).doc!;

    const cut = ok({ t: 'edge.delete', id: 'e1' }, linked);
    expect(cut.doc?.flow.edges.e1).toBeUndefined();

    const back = applyAll(cut.doc!, cut.inverse, { rules: NONE.rules });
    expect(back.doc?.flow.edges.e1).toEqual({
      from: 'n1',
      to: 'n2',
      origin: 'authored',
      label: 'ok',
    });
  });

  test('an unknown connection cannot be deleted, and says what exists', () => {
    const r = apply(doc, { t: 'edge.delete', id: 'nope' }, { rules: NONE.rules });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('unknown-node');
  });
});

/* Moving a selection is ONE gesture, so it is one write and one undo. The
   studio sends the whole batch — reading only the node under the cursor was
   why a shift-selected group moved on screen and only its first screen
   actually moved in the document. */
describe('moving several screens at once', () => {
  const three = (): ProjectDoc => {
    const b = ok({ t: 'node.add', id: 'n2', node: { screen: 'auth', fixture: 'default' } }).doc!;
    return ok({ t: 'node.add', id: 'n3', node: { screen: 'auth', fixture: 'default' } }, b).doc!;
  };

  const moves: Command[] = [
    { t: 'node.update', id: 'n1', patch: { col: 1, lane: 1 } },
    { t: 'node.update', id: 'n2', patch: { col: 2, lane: 1 } },
    { t: 'node.update', id: 'n3', patch: { col: 3, lane: 1 } },
  ];

  test('every screen in the batch moves, not just the first', () => {
    const after = applyAll(three(), moves, { rules: NONE.rules });

    expect(after.ok).toBe(true);
    expect(after.doc?.flow.nodes.n1?.col).toBe(1);
    expect(after.doc?.flow.nodes.n2?.col).toBe(2);
    expect(after.doc?.flow.nodes.n3?.col).toBe(3);
  });

  test('the batch undoes as one', () => {
    const before = three();
    const after = applyAll(before, moves, { rules: NONE.rules });
    const back = applyAll(after.doc!, after.inverse, { rules: NONE.rules });

    expect(JSON.stringify(back.doc)).toBe(JSON.stringify(before));
  });

  test('one bad move in the batch moves nothing', () => {
    const before = three();
    const after = applyAll(
      before,
      [...moves, { t: 'node.update', id: 'gone', patch: { col: 9 } }],
      { rules: NONE.rules },
    );

    expect(after.ok).toBe(false);
    expect(after.doc ?? before).toEqual(before);
  });
});

/* Shared stylesheets. The rules a project is actually built from lived in
   `kit.sheets` with no command able to touch them — readable only by opening
   the JSON, writable not at all. */
describe('sheet.set and sheet.delete', () => {
  test('a sheet can be created and read back', () => {
    const after = ok({ t: 'sheet.set', name: 'ui', css: '.button{color:red}' }).doc!;
    expect(after.kit.sheets.ui).toBe('.button{color:red}');
  });

  test('creating one undoes to it not existing, not to empty', () => {
    const added = ok({ t: 'sheet.set', name: 'ui', css: '.a{}' });
    const back = applyAll(added.doc!, added.inverse, { rules: NONE.rules });

    expect('ui' in (back.doc?.kit.sheets ?? {})).toBe(false);
  });

  test('replacing one undoes to what it said before', () => {
    const first = ok({ t: 'sheet.set', name: 'ui', css: '.a{}' }).doc!;
    const second = ok({ t: 'sheet.set', name: 'ui', css: '.b{}' }, first);
    const back = applyAll(second.doc!, second.inverse, { rules: NONE.rules });

    expect(back.doc?.kit.sheets.ui).toBe('.a{}');
  });

  test('deleting one is undoable', () => {
    const withSheet = ok({ t: 'sheet.set', name: 'ui', css: '.a{}' }).doc!;
    const gone = ok({ t: 'sheet.delete', name: 'ui' }, withSheet);
    expect(gone.doc?.kit.sheets.ui).toBeUndefined();

    const back = applyAll(gone.doc!, gone.inverse, { rules: NONE.rules });
    expect(back.doc?.kit.sheets.ui).toBe('.a{}');
  });

  /* The screens would render unstyled and nothing would report an error. */
  test('a sheet still used by an item cannot be deleted', () => {
    const withSheet = ok({ t: 'sheet.set', name: 'ui', css: '.a{}' }).doc!;
    const using = ok(
      { t: 'item.replace', name: 'auth', item: { ...withSheet.items.auth!, sheets: ['ui'] } },
      withSheet,
    ).doc!;

    const r = apply(using, { t: 'sheet.delete', name: 'ui' }, { rules: NONE.rules });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('in-use');
    expect(r.diagnostics[0]?.available).toEqual(['auth']);
  });

  test('deleting one that is not there says which exist', () => {
    const withSheet = ok({ t: 'sheet.set', name: 'ui', css: '.a{}' }).doc!;
    const r = apply(withSheet, { t: 'sheet.delete', name: 'nope' }, { rules: NONE.rules });

    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.available).toEqual(['ui']);
  });
});

/* A family arrives as several files that differ only by which characters they
   cover, and the browser picks between them per glyph. Keyed without the
   range, adding `latin-ext` replaced `latin` and a language lost its accented
   characters while everything still rendered. */
describe('font subsets', () => {
  const LATIN = 'U+0000-00FF';
  const EXT = 'U+0100-02BA';

  const withAssets = (): ProjectDoc => {
    const a = ok({
      t: 'asset.add',
      id: 'f-latin',
      asset: { kind: 'font', mime: 'font/woff2', bytes: 'AA==' },
    }).doc!;
    return ok(
      { t: 'asset.add', id: 'f-ext', asset: { kind: 'font', mime: 'font/woff2', bytes: 'BB==' } },
      a,
    ).doc!;
  };

  const add = (doc: ProjectDoc, asset: string, unicodeRange: string) =>
    ok(
      { t: 'font.add', asset, family: 'Inter', weight: '400', style: 'normal', unicodeRange },
      doc,
    );

  test('two subsets of one weight both survive', () => {
    const one = add(withAssets(), 'f-latin', LATIN).doc!;
    const two = add(one, 'f-ext', EXT).doc!;

    expect(two.kit.fonts).toHaveLength(2);
    expect(two.kit.fonts.map((f) => f.asset).sort()).toEqual(['f-ext', 'f-latin']);
  });

  test('the same subset added twice replaces itself', () => {
    const one = add(withAssets(), 'f-latin', LATIN).doc!;
    const again = add(one, 'f-ext', LATIN).doc!;

    expect(again.kit.fonts).toHaveLength(1);
    expect(again.kit.fonts[0]?.asset).toBe('f-ext');
  });

  test('the range is kept, not dropped on the way in', () => {
    const one = add(withAssets(), 'f-latin', LATIN).doc!;
    expect(one.kit.fonts[0]?.unicodeRange).toBe(LATIN);
  });

  /* Removing a font must not leave some of its files behind. */
  test('deleting a face takes every subset of it', () => {
    const both = add(add(withAssets(), 'f-latin', LATIN).doc!, 'f-ext', EXT).doc!;
    const gone = ok({ t: 'font.delete', family: 'Inter', weight: '400', style: 'normal' }, both);

    expect(gone.doc?.kit.fonts).toHaveLength(0);
  });

  test('naming a range deletes only that one', () => {
    const both = add(add(withAssets(), 'f-latin', LATIN).doc!, 'f-ext', EXT).doc!;
    const gone = ok(
      { t: 'font.delete', family: 'Inter', weight: '400', style: 'normal', unicodeRange: LATIN },
      both,
    );

    expect(gone.doc?.kit.fonts).toHaveLength(1);
    expect(gone.doc?.kit.fonts[0]?.unicodeRange).toBe(EXT);
  });

  test('undoing a delete brings every subset back', () => {
    const both = add(add(withAssets(), 'f-latin', LATIN).doc!, 'f-ext', EXT).doc!;
    const gone = ok({ t: 'font.delete', family: 'Inter', weight: '400', style: 'normal' }, both);
    const back = applyAll(gone.doc!, gone.inverse, { rules: NONE.rules });

    expect(back.doc?.kit.fonts).toHaveLength(2);
    expect(back.doc?.kit.fonts.map((f) => f.unicodeRange).sort()).toEqual([LATIN, EXT].sort());
  });
});

/* A sequence is one change made of several writes, and the states in between
   are not states the document is ever in. Judging them reports problems that
   do not exist — and once a rule is an error rather than a warning, refuses
   whole operations that would have been perfectly valid. */
describe('a batch is judged on where it ends', () => {
  test('an intermediate state that breaks a rule does not fail the batch', () => {
    // Stamping a key into markup leaves it without an entry until the next
    // command adds one. Between the two, the document is not translatable.
    const stamped = applyAll(
      doc,
      [
        { t: 'item.setHtml', name: 'auth', html: '<h1 data-t="auth.new">Hello</h1>' },
        { t: 'strings.set', locale: 'en', entries: { 'auth.new': 'Hello' } },
      ],
      {},
    );

    expect(stamped.ok).toBe(true);
    expect(stamped.doc?.strings.locales.en?.entries['auth.new']).toBe('Hello');
    expect(stamped.diagnostics.filter((d) => d.code === 'missing-string')).toEqual([]);
  });

  test('the same commands the other way round would leave a real problem', () => {
    // The end state is what counts, so an order that genuinely ends badly is
    // still caught: here the key is registered and never used.
    const orphan = applyAll(
      doc,
      [{ t: 'strings.set', locale: 'en', entries: { 'auth.never-used': 'Hello' } }],
      {},
    );

    expect(orphan.ok).toBe(true); // an unused key is not an error
    expect(orphan.doc?.strings.locales.en?.entries['auth.never-used']).toBe('Hello');
  });

  /* Prechecks are a different question — whether a command makes sense
     against the document it is actually applied to — and still run per step. */
  test('a command that cannot apply still stops the batch', () => {
    const r = applyAll(doc, [
      { t: 'node.update', id: 'n1', patch: { title: 'Fine' } },
      { t: 'node.update', id: 'ghost', patch: { title: 'Not fine' } },
    ]);

    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'unknown-node')).toBe(true);
    expect(r.doc).toBeUndefined();
  });

  test('a batch whose END state is invalid is refused', () => {
    const r = applyAll(doc, [
      { t: 'item.create', name: 'orphan', tier: 'screen', html: '<p>x</p>' },
      { t: 'item.delete', name: 'auth' },
    ]);

    // 'auth' is still on the canvas, so deleting it is refused by its own
    // precheck — the batch does not land halfway.
    expect(r.ok).toBe(false);
    expect(r.doc).toBeUndefined();
  });
});

/* Variants live in the registry so the set is closed and therefore
   enumerable — which is what lets a kit page list what exists rather than
   being maintained by hand. */
describe('variants', () => {
  test('a variant is added and undone', () => {
    const added = ok({
      t: 'item.setVariant',
      name: 'auth',
      variant: 'confirmed',
      value: { label: 'Confirmed', class: 'is-confirmed' },
    });

    expect(added.doc?.items.auth?.variants?.confirmed?.class).toBe('is-confirmed');

    const back = applyAll(added.doc!, added.inverse, { rules: NONE.rules });
    expect(back.doc?.items.auth?.variants).toBeUndefined();
  });

  test('a second variant joins the first', () => {
    const one = ok({
      t: 'item.setVariant',
      name: 'auth',
      variant: 'a',
      value: { class: 'is-a' },
    }).doc!;
    const two = ok(
      { t: 'item.setVariant', name: 'auth', variant: 'b', value: { class: 'is-b' } },
      one,
    ).doc!;

    expect(Object.keys(two.items.auth?.variants ?? {}).sort()).toEqual(['a', 'b']);
  });

  test('deleting one restores it on undo', () => {
    const withOne = ok({
      t: 'item.setVariant',
      name: 'auth',
      variant: 'a',
      value: { class: 'is-a' },
    }).doc!;
    const gone = ok({ t: 'item.deleteVariant', name: 'auth', variant: 'a' }, withOne);

    expect(gone.doc?.items.auth?.variants?.a).toBeUndefined();

    const back = applyAll(gone.doc!, gone.inverse, { rules: NONE.rules });
    expect(back.doc?.items.auth?.variants?.a?.class).toBe('is-a');
  });
});
