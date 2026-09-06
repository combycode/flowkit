/* Scroll the content inside a screen.
 *
 * These screens are app shells: the document itself does not scroll, an
 * element inside it does (`.chat` is 1382px in a 583px viewport, `.cabinet`
 * 1568 in 784). So a plain wheel event cannot be forwarded to the document —
 * we have to find the element that actually scrolls and move it.
 *
 * The gesture is modifier + wheel, because plain wheel belongs to the canvas.
 * Taking it for the screen would mean you could no longer zoom out while the
 * pointer happened to be over one of sixty-two screens, which is most of the
 * canvas.
 *
 * Reaching into the iframe is only possible because `srcdoc` inherits the
 * parent's origin — the property Spike A was built to prove.
 */

import { type RefObject, useEffect } from 'react';

/** The scrollable element, or null. Outermost wins, which is the one a person
 *  means.
 *
 *  The DOCUMENT first, and it has to be `scrollingElement` rather than the
 *  body: on a page that scrolls as a document — a kit page of twenty icons,
 *  say — the body reports the overflow but does not own the scroll, so setting
 *  `body.scrollTop` moves nothing and the gesture looks broken. Only then the
 *  panes, because an app shell does not scroll as a document: something inside
 *  it does. */
export function scrollerIn(doc: Document): HTMLElement | null {
  const page = doc.scrollingElement as HTMLElement | null;
  if (page && page.scrollHeight > page.clientHeight + 4) return page;

  const stack: HTMLElement[] = doc.body ? [doc.body] : [];
  while (stack.length > 0) {
    const el = stack.shift();
    if (!el) continue;
    if (el.scrollHeight > el.clientHeight + 4) return el;
    stack.push(...(Array.from(el.children) as HTMLElement[]));
  }
  return null;
}

export function useScreenScroll(ref: RefObject<HTMLIFrameElement | null>, enabled = true): void {
  useEffect(() => {
    const frame = ref.current;
    if (!frame || !enabled) return;

    const onWheel = (e: WheelEvent) => {
      // Plain wheel stays with the canvas.
      if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
      // The gesture is ours from here, scroller or not. Handing it back to the
      // canvas would zoom the whole map because a screen happened to have
      // nothing to scroll, which reads as the modifier being ignored.
      e.preventDefault();
      e.stopPropagation();

      const inner = frame.contentDocument;
      if (!inner) return; // cross-origin should be impossible for srcdoc, but do not crash
      const scroller = scrollerIn(inner);
      if (!scroller) return;
      scroller.scrollTop += e.deltaY;
    };

    // Non-passive: the whole point is to preventDefault so the canvas does not
    // also zoom on the same gesture.
    frame.parentElement?.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.parentElement?.removeEventListener('wheel', onWheel);
  }, [ref, enabled]);
}
