import { describe, expect, test } from 'bun:test';
import { applyStrings, extractStrings, hasVisibleText, scanText } from '../src/index';

describe('scanText', () => {
  test('finds text directly inside an element', () => {
    const html = '<h1>Sign in</h1>';
    expect(scanText(html).map((e) => e.tag)).toEqual(['h1']);
  });

  test('separates text nodes that sit around child elements', () => {
    // The shape that matters here: a button whose label sits between a dot and
    // an icon. Treating only leaf elements as translatable missed these.
    const html = '<button><span class="dot"></span>Build a website<svg></svg></button>';
    const [el] = scanText(html);
    expect(el?.tag).toBe('button');
    expect(el?.texts.length).toBe(1);
    expect(html.slice(el!.texts[0]!.start, el!.texts[0]!.end)).toBe('Build a website');
  });

  test('ignores script, style and svg content', () => {
    const html =
      '<style>.a{color:red}</style><script>var x = 1;</script><svg><path>M0</path></svg>';
    expect(scanText(html)).toEqual([]);
  });

  test('is not confused by a > inside an attribute value', () => {
    const html = '<div title="a > b">hello</div>';
    const [el] = scanText(html);
    expect(html.slice(el!.texts[0]!.start, el!.texts[0]!.end)).toBe('hello');
  });

  test('skips punctuation and entities with no letters', () => {
    expect(scanText('<span>·</span><span>&nbsp;</span>')).toEqual([]);
    expect(hasVisibleText(' &mdash; ')).toBe(false);
    expect(hasVisibleText('4')).toBe(true);
  });
});

describe('extractStrings', () => {
  test('stamps a key and collects the text', () => {
    const r = extractStrings('<h1>Sign in</h1>', 'auth');
    expect(r.html).toBe('<h1 data-t="auth.sign-in">Sign in</h1>');
    expect(r.entries).toEqual({ 'auth.sign-in': 'Sign in' });
  });

  test('gives one key per text node, pipe separated, in order', () => {
    const r = extractStrings('<p>Before<b>x</b>After</p>', 's');
    expect(r.html).toContain('data-t="s.before|s.after"');
    expect(Object.values(r.entries)).toContain('Before');
    expect(Object.values(r.entries)).toContain('After');
  });

  test('suffixes a colliding key rather than overwriting', () => {
    const r = extractStrings('<p>Save</p><p>Save</p>', 's');
    expect(Object.keys(r.entries).sort()).toEqual(['s.save', 's.save-2']);
  });

  test('leaves everything it does not stamp byte-identical', () => {
    const html = '<div class = "a"   data-x=\'1\'><em>Hi</em></div>';
    // Only the <em> gains an attribute; the odd spacing and quoting survive.
    expect(extractStrings(html, 's').html).toBe(
      '<div class = "a"   data-x=\'1\'><em data-t="s.hi">Hi</em></div>',
    );
  });

  test('does not re-stamp an already stamped element', () => {
    const once = extractStrings('<h1>Sign in</h1>', 'a');
    // Re-run knowing the key is already registered: no new key, no backfill.
    const twice = extractStrings(once.html, 'b', new Set(['a.sign-in']));
    expect(twice.html).toBe(once.html);
    expect(twice.entries).toEqual({});
    expect(twice.keyed).toBe(0);
    expect(twice.backfilled).toBe(0);
  });

  test('backfills a hand-authored key that has no entry, without touching markup', () => {
    const r = extractStrings('<h1 data-t="signin.title">Sign in</h1>', 'p');
    expect(r.html).toBe('<h1 data-t="signin.title">Sign in</h1>'); // unchanged
    expect(r.entries).toEqual({ 'signin.title': 'Sign in' });
    expect(r.keyed).toBe(0);
    expect(r.backfilled).toBe(1);
  });

  test('a key that already has an entry is left alone', () => {
    const r = extractStrings(
      '<h1 data-t="signin.title">Sign in</h1>',
      'p',
      new Set(['signin.title']),
    );
    expect(r.entries).toEqual({});
    expect(r.backfilled).toBe(0);
  });

  test('a hand-stamped key is never reused for a sibling unstamped text', () => {
    // Forward: the stamped <h1> comes first, then a <p> that slugs to the same
    // key. The <h1>'s entry must not be overwritten, and the <p> gets its own.
    const fwd = extractStrings('<h1 data-t="home.welcome">Welcome back</h1><p>Welcome</p>', 'home');
    expect(fwd.entries['home.welcome']).toBe('Welcome back');
    const other = Object.keys(fwd.entries).filter((k) => k !== 'home.welcome');
    expect(other).toHaveLength(1);
    expect(fwd.entries[other[0] as string]).toBe('Welcome');

    // Reverse: the unstamped <p> comes first; it still must not steal the key.
    const rev = extractStrings('<p>Welcome</p><h1 data-t="home.welcome">Welcome back</h1>', 'home');
    expect(rev.entries['home.welcome']).toBe('Welcome back');
  });

  test('backfills each piped key against its own text span', () => {
    // The <b> is already keyed and known, so only the parent's two spans backfill.
    const r = extractStrings(
      '<p data-t="s.a|s.b">One<b data-t="s.c">x</b>Two</p>',
      's',
      new Set(['s.c']),
    );
    expect(r.entries).toEqual({ 's.a': 'One', 's.b': 'Two' });
    expect(r.backfilled).toBe(2);
    expect(r.keyed).toBe(0);
  });
});

describe('applyStrings', () => {
  const stamped = extractStrings('<h1>Sign in</h1>', 'auth').html;

  test('swaps the text for the locale value', () => {
    expect(applyStrings(stamped, { 'auth.sign-in': 'Войти' })).toBe(
      '<h1 data-t="auth.sign-in">Войти</h1>',
    );
  });

  test('keeps the inline default when a key is missing, so partial locales render', () => {
    expect(applyStrings(stamped, { other: 'x' })).toBe(stamped);
  });

  test('replaces each text node of a multi-key element independently', () => {
    const src = extractStrings('<p>Before<b>x</b>After</p>', 's').html;
    const out = applyStrings(src, { 's.before': 'До', 's.after': 'После' });
    // The nested <b> gets stamped too, so match around it rather than
    // assuming the original bare tag.
    expect(out).toContain('>До<b ');
    expect(out).toContain('</b>После</p>');
    expect(out).toContain('>x</b>'); // the untranslated child is left alone
  });

  test('preserves surrounding whitespace, which is a real space between inline elements', () => {
    const src = extractStrings('<p><b>a</b> word <i>b</i></p>', 's').html;
    const out = applyStrings(src, { 's.word': 'слово' });
    expect(out).toContain('</b> слово <i ');
  });

  test('escapes markup in a translation', () => {
    expect(applyStrings(stamped, { 'auth.sign-in': '<script>' })).toContain('&lt;script&gt;');
  });

  test('is a no-op for an empty locale', () => {
    expect(applyStrings(stamped, {})).toBe(stamped);
  });
});
