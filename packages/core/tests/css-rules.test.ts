/* Reading a stylesheet well enough to move rules out of it.
 *
 * The regex version of this reported that a component owned twelve kilobytes
 * of a sheet. It had matched a comment — this design draws boxes several lines
 * wide before each section — and every byte of that claim was wrong. Anything
 * that decides ownership has to actually parse.
 */

import { describe, expect, test } from 'bun:test';
import { claims, contextClasses, splitRules, subjectClasses } from '../src/styles/rules';

describe('splitting a sheet into rules', () => {
  test('the plain case', () => {
    const rules = splitRules('.a { color: red } .b { color: blue }');
    expect(rules.map((r) => r.selector)).toEqual(['.a', '.b']);
    expect(rules[0]?.body.trim()).toBe('color: red');
  });

  /* The bug this file exists for. */
  test('a comment is not a selector', () => {
    const css = `/* ────────────────────────────
   The operator's console
   ──────────────────────────── */
.panel { color: red }`;
    const rules = splitRules(css);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toBe('.panel');
  });

  test('and a comment between rules stays with the rule it introduces', () => {
    const rules = splitRules('.a { x: 1 }\n/* about b */\n.b { y: 2 }');
    expect(rules).toHaveLength(2);
    expect(rules[1]?.text).toContain('/* about b */');
    expect(rules[1]?.text).toContain('.b');
  });

  /* The invariant everything downstream leans on: a rule can be cut out of the
     sheet it came from by its own offsets. Without it, moving CSS would delete
     the wrong bytes — and the deleted ones would be somebody else's rule. */
  test('every rule is exactly the slice it says it is', () => {
    const css = [
      '/* head */',
      '.a { x: 1 }',
      '',
      '@media (max-width: 700px) {',
      '  /* small */',
      '  .b { y: 2 }',
      '  .c::before { content: "}" }',
      '}',
      '@keyframes spin { from { r: 0 } }',
      '.d,\n.e > .f { z: 3 }',
    ].join('\n');

    for (const rule of splitRules(css)) {
      expect(css.slice(rule.start, rule.end)).toBe(rule.text);
    }
  });

  test('and the rules of a sheet do not overlap', () => {
    const rules = splitRules('.a { x: 1 } .b { y: 2 } @media print { .c { z: 3 } }');
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i]?.start).toBeGreaterThanOrEqual(rules[i - 1]?.end ?? 0);
    }
  });

  test('a brace inside a string is not a block', () => {
    const rules = splitRules('.a::before { content: "{" } .b { x: 1 }');
    expect(rules.map((r) => r.selector)).toEqual(['.a::before', '.b']);
  });

  test('a media query yields its rules, carrying the condition', () => {
    const rules = splitRules('@media (max-width: 700px) { .a { x: 1 } .b { y: 2 } }');

    expect(rules).toHaveLength(2);
    expect(rules[0]?.selector).toBe('.a');
    expect(rules[0]?.conditions).toEqual(['@media (max-width: 700px)']);
  });

  test('nested conditions come out in order, outermost first', () => {
    const rules = splitRules('@supports (x: 1) { @media print { .a { y: 2 } } }');
    expect(rules[0]?.conditions).toEqual(['@supports (x: 1)', '@media print']);
  });

  /* Keyframe steps are not selectors, and `from`/`to` are not classes. Reading
     into one would attribute an animation to whichever part matched. */
  test('keyframes stay whole', () => {
    const rules = splitRules('@keyframes spin { from { r: 0 } to { r: 1 } } .a { x: 1 }');

    expect(rules.map((r) => r.selector)).toEqual(['@keyframes spin', '.a']);
  });

  test('and so does a font face', () => {
    const rules = splitRules('@font-face { font-family: X } .a { x: 1 }');
    expect(rules.map((r) => r.selector)).toEqual(['@font-face', '.a']);
  });

  test('a statement at-rule is skipped rather than swallowing the sheet', () => {
    const rules = splitRules('@import url("x.css"); .a { x: 1 }');
    expect(rules.map((r) => r.selector)).toEqual(['.a']);
  });

  /* The span reaches back over the whitespace before the rule, so cutting one
     out does not leave the blank line it sat on behind. */
  test('the offsets point at the rule in the sheet it came from', () => {
    const css = '.a { x: 1 }\n.b { y: 2 }';
    const [, second] = splitRules(css);

    expect(css.slice(second?.start, second?.end)).toBe('\n.b { y: 2 }');
    expect(second?.selector).toBe('.b');
  });

  test('an unterminated rule does not hang or throw', () => {
    expect(() => splitRules('.a { x: 1')).not.toThrow();
    expect(() => splitRules('/* never closed')).not.toThrow();
    expect(() => splitRules('.a { content: "unclosed')).not.toThrow();
  });
});

describe('what a rule is about', () => {
  /* `.chat .msg-bot` styles a message inside a chat. Reading it the other way
     round would give every container the CSS of everything it contains. */
  test('the subject is the rightmost compound', () => {
    expect([...subjectClasses('.chat .msg-bot')]).toEqual(['msg-bot']);
    expect([...contextClasses('.chat .msg-bot')]).toEqual(['chat']);
  });

  test('through every combinator', () => {
    expect([...subjectClasses('.a > .b + .c ~ .d')]).toEqual(['d']);
  });

  test('a list of selectors contributes each of its subjects', () => {
    expect([...subjectClasses('.a, .b .c')].sort()).toEqual(['a', 'c']);
  });

  test('a comma inside :is() does not split the selector', () => {
    expect([...subjectClasses(':is(.a, .b) .c')]).toEqual(['c']);
    expect([...contextClasses(':is(.a, .b) .c')].sort()).toEqual(['a', 'b']);
  });

  test('a modifier on the subject is still the subject', () => {
    expect([...subjectClasses('.tag:not(.tag--dim)')].sort()).toEqual(['tag', 'tag--dim']);
  });

  test('a pseudo-element belongs to what it hangs off', () => {
    expect([...subjectClasses('.f::after')]).toEqual(['f']);
  });

  test('an attribute selector on the body is context, not subject', () => {
    expect([...subjectClasses('body[data-spec="closed"] .spec')]).toEqual(['spec']);
  });
});

describe('which part a class belongs to', () => {
  test('the part itself, and anything under its name', () => {
    expect(claims('tag', 'tag')).toBe(true);
    expect(claims('tag', 'tag-label')).toBe(true);
    expect(claims('tag', 'tag__label')).toBe(true);
    expect(claims('tag', 'tag--dim')).toBe(true);
  });

  /* Without the boundary check, `f` would claim every class in the design that
     happens to start with an f. */
  test('but not a different word that starts the same way', () => {
    expect(claims('tag', 'tagline')).toBe(false);
    expect(claims('f', 'field')).toBe(false);
    expect(claims('f', 'f')).toBe(true);
    expect(claims('f', 'f-label')).toBe(true);
  });
});
