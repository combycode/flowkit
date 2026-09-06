/* Matching a shape with holes.
 *
 * The hard case is nesting: the shape of a message row is a div with a slot in
 * it, and the first `</div>` after the opening closes the div INSIDE the row.
 * A matcher that stops there cuts every message in half, and the byte
 * comparison downstream cannot tell — putting the halves back composes to the
 * original either way.
 */

import { describe, expect, test } from 'bun:test';
import type { Shape } from '../src/index';
import { matchShape, parseShape, unbalanced } from '../src/index';

const shape = (template: string): Shape => {
  const read = parseShape(template);
  if ('problem' in read) throw new Error(read.problem);
  return read;
};

describe('parseShape', () => {
  test('splits a template into literals and holes', () => {
    const out = shape('<div class="row"><x-slot/><x-edit/></div>');

    expect(out.segments).toEqual(['<div class="row">', '<x-edit/></div>']);
    expect(out.slots).toEqual(['']);
  });

  test('reads slot names, and a slot with default content is still a hole', () => {
    const out = shape('<div><x-slot name="head">Title</x-slot><hr><x-slot name="body"/></div>');

    expect(out.slots).toEqual(['head', 'body']);
    expect(out.segments).toEqual(['<div>', '<hr>', '</div>']);
  });

  /* Each refusal is a match the tool could not make sense of, said before it
     rewrites sixty screens rather than after. */
  test('refuses what cannot be matched', () => {
    const problem = (t: string) => {
      const r = parseShape(t);
      return 'problem' in r ? r.problem : 'no problem';
    };

    expect(problem('<div class="row"></div>')).toContain('no <x-slot/>');
    expect(problem('<x-slot/></div>')).toContain('no left edge');
    expect(problem('<div><x-slot/>')).toContain('no right edge');
    expect(problem('<div><x-slot name="a"/><x-slot name="b"/></div>')).toContain('adjacent');
    expect(problem('<div><x-slot name="a"/>x<x-slot name="a"/></div>')).toContain('same name');
  });
});

describe('matchShape', () => {
  const row = shape('<div class="row-user"><x-slot/></div>');

  test('a hole stops where the content is whole, not at the first close', () => {
    const html = '<div class="row-user"><div class="in">hi</div></div>';
    const [found] = matchShape(html, row);

    expect(found?.fills).toEqual(['<div class="in">hi</div>']);
    expect(found?.end).toBe(html.length);
  });

  test('two in a row are two matches, not one swallowing both', () => {
    const html = '<div class="row-user"><b>one</b></div>\n<div class="row-user"><b>two</b></div>';
    const found = matchShape(html, row);

    expect(found).toHaveLength(2);
    expect(found.map((m) => m.fills[0])).toEqual(['<b>one</b>', '<b>two</b>']);
  });

  test('several holes fill in order', () => {
    const card = shape(
      '<article><h2><x-slot name="title"/></h2><p><x-slot name="body"/></p></article>',
    );
    const [found] = matchShape('<article><h2>Hi</h2><p>There</p></article>', card);

    expect(found?.fills).toEqual(['Hi', 'There']);
  });

  test('an opening that leads nowhere is skipped, not reported', () => {
    const html = '<div class="row-user"><b>never closed';
    expect(matchShape(html, row)).toEqual([]);
  });

  /* Void elements do not open a level; treating <img> as one would leave every
     fill after it looking unbalanced. */
  test('a void element does not hold the hole open', () => {
    const [found] = matchShape('<div class="row-user"><img src="a.png"><b>x</b></div>', row);
    expect(found?.fills).toEqual(['<img src="a.png"><b>x</b>']);
  });

  test('an attribute value containing a bracket does not end a tag', () => {
    const [found] = matchShape('<div class="row-user"><b title="a > b">x</b></div>', row);
    expect(found?.fills).toEqual(['<b title="a > b">x</b>']);
  });

  test('the same shape nested inside itself matches the outer one once', () => {
    const html = '<div class="row-user"><div class="row-user">in</div></div>';
    const found = matchShape(html, row);

    expect(found).toHaveLength(1);
    expect(found[0]?.fills).toEqual(['<div class="row-user">in</div>']);
  });
});

describe('unbalanced', () => {
  test('says nothing about markup that is whole', () => {
    expect(unbalanced('<p>hi <b>there</b></p><img src="x">')).toBeUndefined();
    expect(unbalanced('just text')).toBeUndefined();
    expect(unbalanced('<x-icon-back/>')).toBeUndefined();
  });

  test('names what is wrong', () => {
    expect(unbalanced('<div><p>x</div>')).toContain('</div> where <p> is still open');
    expect(unbalanced('</div><div>x</div>')).toContain('without opening it');
    expect(unbalanced('<section>x')).toContain('never closed');
  });
});
