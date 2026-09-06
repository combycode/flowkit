/* The two things a document gained when it stopped being only screens: a line
 * that can say something, and a place to write down what there is no field for
 * yet. Neither is read by anything here — which is exactly why they need a test
 * saying they survive a write and come back on undo. */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import { apply } from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'screen',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
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
    items: { home: item({ html: '<main></main>' }), next: item({ html: '<main></main>' }) },
    flow: {
      nodes: {
        home: { screen: 'home', fixture: 'default' },
        next: { screen: 'next', fixture: 'default' },
      },
      edges: { 'edge-1': { from: 'home', to: 'next' } },
      groups: [{ id: 'main', label: 'Main' }],
    },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('how a connection is drawn', () => {
  test('a line carries a width, a colour and a dash', () => {
    const r = apply(project(), {
      t: 'edge.update',
      id: 'edge-1',
      style: { width: 3, color: '#4a7cf7', dash: true },
    });

    expect(r.ok).toBe(true);
    expect(r.doc?.flow.edges['edge-1']?.style).toEqual({
      width: 3,
      color: '#4a7cf7',
      dash: true,
    });
  });

  test('and comes back as it was on undo', () => {
    const styled = apply(project(), {
      t: 'edge.update',
      id: 'edge-1',
      style: { width: 3 },
    });
    const changed = apply(styled.doc as ProjectDoc, {
      t: 'edge.update',
      id: 'edge-1',
      style: { width: 9, dash: true },
    });
    const back = apply(changed.doc as ProjectDoc, changed.inverse[0] as never);

    expect(back.doc?.flow.edges['edge-1']?.style).toEqual({ width: 3 });
  });

  /* Found by an export, not by a test: the light viewer came out with a
     failure branch that had lost its label. `patch` reads an undefined value
     as "remove this", so naming both fields unconditionally meant setting a
     colour quietly took the label away. */
  test('setting the line does not take the label with it', () => {
    const labelled = apply(project(), { t: 'edge.update', id: 'edge-1', label: 'failed' });
    const styled = apply(labelled.doc as ProjectDoc, {
      t: 'edge.update',
      id: 'edge-1',
      style: { dash: true },
    });

    expect(styled.doc?.flow.edges['edge-1']?.label).toBe('failed');
  });

  test('and naming it as undefined still clears it', () => {
    const labelled = apply(project(), { t: 'edge.update', id: 'edge-1', label: 'failed' });
    const cleared = apply(labelled.doc as ProjectDoc, {
      t: 'edge.update',
      id: 'edge-1',
      label: undefined,
    });

    expect(cleared.doc?.flow.edges['edge-1']?.label).toBeUndefined();
  });

  test('a deleted screen brings its connections back drawn as they were', () => {
    const styled = apply(project(), {
      t: 'edge.update',
      id: 'edge-1',
      label: 'failed',
      style: { dash: true, color: '#e8c460' },
    });
    const removed = apply(styled.doc as ProjectDoc, { t: 'node.delete', id: 'next' });
    let back = removed.doc as ProjectDoc;
    for (const step of removed.inverse) back = (apply(back, step).doc ?? back) as ProjectDoc;

    expect(back.flow.edges['edge-1']).toMatchObject({
      label: 'failed',
      style: { dash: true, color: '#e8c460' },
    });
  });

  test('a connection can be drawn styled from the start', () => {
    const r = apply(project(), {
      t: 'edge.connect',
      id: 'edge-2',
      from: 'next',
      to: 'home',
      label: 'back',
      style: { dash: true },
    });

    expect(r.doc?.flow.edges['edge-2']).toMatchObject({ label: 'back', style: { dash: true } });
  });
});

describe('free-form meta', () => {
  /* Arbitrary JSON rather than strings: a list of endpoints has to stay a list,
     or it becomes a comma-joined line nobody can read back. */
  test('an item keeps whatever is written on it', () => {
    const r = apply(project(), {
      t: 'item.setMeta',
      name: 'home',
      meta: { reads: ['orders', 'payments'], role: 'client', ticket: 'SW-4417' },
    });

    expect(r.doc?.items.home?.meta).toEqual({
      reads: ['orders', 'payments'],
      role: 'client',
      ticket: 'SW-4417',
    });
  });

  test('and so does a node', () => {
    const r = apply(project(), {
      t: 'node.update',
      id: 'home',
      patch: { meta: { role: 'client' } },
    });

    expect(r.doc?.flow.nodes.home?.meta).toEqual({ role: 'client' });
  });

  test('nothing validates it — that is the point', () => {
    const r = apply(project(), {
      t: 'item.setMeta',
      name: 'home',
      meta: { anything: { nested: [1, 2, { deep: true }] } },
    });

    expect(r.ok).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  /* The reducer used to name description, viewport and meta on every call, and
     `patch` reads an undefined value as "remove this" — so setting a
     description silently cleared the size a screen was pinned to. */
  test('a description set later does not take the meta with it', () => {
    const first = apply(project(), { t: 'item.setMeta', name: 'home', meta: { role: 'client' } });
    const second = apply(first.doc as ProjectDoc, {
      t: 'item.setMeta',
      name: 'home',
      description: 'The chat',
    });

    expect(second.doc?.items.home?.meta).toEqual({ role: 'client' });
    expect(second.doc?.items.home?.description).toBe('The chat');
  });

  test('nor the size the screen is pinned to', () => {
    const pinned = apply(project(), { t: 'item.setMeta', name: 'home', viewport: 'mobile' });
    const described = apply(pinned.doc as ProjectDoc, {
      t: 'item.setMeta',
      name: 'home',
      description: 'The chat',
    });

    expect(described.doc?.items.home?.viewport).toBe('mobile');
  });

  /* Clearing has to stay possible, and it is the same rule a node patch uses:
     omitting a key leaves it, naming it as undefined removes it. */
  test('but naming a field as undefined still clears it', () => {
    const pinned = apply(project(), { t: 'item.setMeta', name: 'home', viewport: 'mobile' });
    const cleared = apply(pinned.doc as ProjectDoc, {
      t: 'item.setMeta',
      name: 'home',
      viewport: undefined,
    });

    expect(cleared.doc?.items.home?.viewport).toBeUndefined();
  });
});

/* The same mistake three times in one day, so it gets a home of its own: a
 * command that writes a WHOLE record, driven by something that only knows part
 * of one. Undo needs the whole record — that is why the commands are shaped
 * this way — and every caller that builds one from its own arguments silently
 * drops whatever it had no argument for. */
describe('a partial write must not erase what it was not told about', () => {
  test('adding a node over one that exists is refused, not applied', () => {
    const doc = project();
    doc.flow.nodes.home = {
      screen: 'home',
      fixture: 'default',
      title: 'Home',
      col: 4,
      lane: 2,
      groups: ['main'],
      meta: { role: 'client' },
    };

    const r = apply(doc, {
      t: 'node.add',
      id: 'home',
      node: { screen: 'home', fixture: 'default' },
    });

    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('duplicate-name');
    // and nothing moved
    expect(r.doc).toBeUndefined();
  });

  test('a node id nobody has taken is still free', () => {
    const r = apply(project(), {
      t: 'node.add',
      id: 'fresh',
      node: { screen: 'home', fixture: 'default' },
    });

    expect(r.ok).toBe(true);
  });

  /* Deleting a node and undoing it re-adds the same id, which the check above
     must not stand in the way of. */
  test('undoing a delete can still put the node back', () => {
    const doc = project();
    doc.flow.nodes.home = { screen: 'home', fixture: 'default', title: 'Home', col: 4 };

    const removed = apply(doc, { t: 'node.delete', id: 'home' });
    let back = removed.doc as ProjectDoc;
    for (const step of removed.inverse) back = (apply(back, step).doc ?? back) as ProjectDoc;

    expect(back.flow.nodes.home).toMatchObject({ title: 'Home', col: 4 });
  });
});
