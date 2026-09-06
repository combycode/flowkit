/* Clamping a selection to the page it is drawn on.
 *
 * The canvas is infinite and the page is not, so a rectangle drawn with room
 * to spare around a screen starts outside it. Chromium does not honour a clip
 * with a negative origin — it photographs the top-left corner of the document
 * instead — so a gesture over the kit came back as a picture of the first
 * screen in the flow, with nothing to say anything had gone wrong.
 */

import { describe, expect, test } from 'bun:test';
import { within } from '../src/tools/selection';

const page = { width: 1000, height: 800 };

describe('within', () => {
  test('a rectangle inside the page is left alone', () => {
    expect(within({ x: 10, y: 20, width: 100, height: 50 }, page)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  test('one that starts outside keeps the part that is on the page', () => {
    expect(within({ x: -40, y: -30, width: 100, height: 100 }, page)).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 70,
    });
  });

  test('one that runs off the end is cut at the edge', () => {
    expect(within({ x: 900, y: 700, width: 400, height: 400 }, page)).toEqual({
      x: 900,
      y: 700,
      width: 100,
      height: 100,
    });
  });

  /* Which the caller turns into "there are no screens under that", rather
     than a picture of somewhere else. */
  test('one entirely off the page comes back empty', () => {
    const off = within({ x: -500, y: 0, width: 200, height: 200 }, page);
    expect(off.width).toBeLessThan(1);
  });
});
