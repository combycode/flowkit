/* Which element a screen actually scrolls.
 *
 * No DOM here: the function reads four properties, so a shaped object is a
 * fair stand-in and the test stays about the decision rather than about a
 * browser.
 */

import { describe, expect, test } from 'bun:test';
import { scrollerIn } from '../src/canvas/useScreenScroll';

interface Fake {
  scrollHeight: number;
  clientHeight: number;
  children: Fake[];
  name: string;
}

const el = (
  name: string,
  scrollHeight: number,
  clientHeight: number,
  children: Fake[] = [],
): Fake => ({
  name,
  scrollHeight,
  clientHeight,
  children,
});

const document = (scrollingElement: Fake | null, body: Fake | null): Document =>
  ({ scrollingElement, body }) as unknown as Document;

describe('scrollerIn', () => {
  /* The bug: on a page that scrolls as a document the BODY reports the
     overflow but does not own the scroll, so `body.scrollTop = n` moved
     nothing and ctrl+wheel looked broken. */
  test('a document that scrolls is scrolled by its scrolling element', () => {
    const body = el('body', 3000, 900);
    const root = el('html', 3000, 900, [body]);

    expect((scrollerIn(document(root, body)) as unknown as Fake).name).toBe('html');
  });

  /* An app shell is 100vh and does not scroll as a document: a pane inside it
     does, and that pane is what a person means. */
  test('an app shell hands the gesture to the pane inside it', () => {
    const chat = el('chat', 1382, 583);
    const body = el('body', 844, 844, [el('header', 60, 60), chat]);
    const root = el('html', 844, 844, [body]);

    expect((scrollerIn(document(root, body)) as unknown as Fake).name).toBe('chat');
  });

  test('the outermost scroller wins over one nested inside it', () => {
    const inner = el('inner', 900, 100);
    const outer = el('outer', 2000, 400, [inner]);
    const body = el('body', 844, 844, [outer]);

    expect((scrollerIn(document(el('html', 844, 844, [body]), body)) as unknown as Fake).name).toBe(
      'outer',
    );
  });

  test('a screen with nothing to scroll says so', () => {
    const body = el('body', 844, 844, [el('main', 800, 800)]);

    expect(scrollerIn(document(el('html', 844, 844, [body]), body))).toBeNull();
  });

  test('a document without a body does not throw', () => {
    expect(scrollerIn(document(null, null))).toBeNull();
  });
});
