/* Handing a URL to the desktop.
 *
 * The command is built separately from being run so it can be checked without
 * a window appearing on somebody's screen — which is also the reason this is
 * never called except when a person asks for it.
 */

import { describe, expect, test } from 'bun:test';
import { openCommand } from '../src/open';

describe('the command for a platform', () => {
  /* `start` is a cmd builtin whose first quoted argument is the WINDOW TITLE.
     `start "http://…"` opens a console window titled with the address and no
     browser at all — the empty title is what makes it a URL. */
  test('windows passes an empty title before the url', () => {
    expect(openCommand('win32', 'http://127.0.0.1:5190/?project=demo')).toEqual([
      'cmd',
      ['/c', 'start', '', 'http://127.0.0.1:5190/?project=demo'],
    ]);
  });

  test('macos uses open', () => {
    expect(openCommand('darwin', 'http://x')).toEqual(['open', ['http://x']]);
  });

  test('and everything else xdg-open', () => {
    expect(openCommand('linux', 'http://x')).toEqual(['xdg-open', ['http://x']]);
    expect(openCommand('freebsd', 'http://x')).toEqual(['xdg-open', ['http://x']]);
  });

  /* The url is one argv entry, never spliced into a command line, so a query
     string cannot become a second argument or anything worse. */
  test('the url stays a single argument whatever is in it', () => {
    const nasty = 'http://127.0.0.1:5190/?project=a%20b&x=1"; calc.exe';
    const [, args] = openCommand('win32', nasty);

    expect(args[args.length - 1]).toBe(nasty);
    expect(args).toHaveLength(4);
  });
});
