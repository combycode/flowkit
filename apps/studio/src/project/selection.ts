/* Reading what is under a rectangle, and handing it to the host.
 *
 * The screens on the canvas are `srcdoc` iframes, which inherit this origin,
 * so their documents can be read. That is what makes a selection more than a
 * picture: an agent gets the actual elements — their classes, their string
 * keys, their text — and can change the right one instead of inferring which
 * div a blurry corner belonged to.
 */

export interface SelectedElement {
  node: string;
  tag: string;
  id?: string;
  classes?: string;
  key?: string;
  text?: string;
  box: { x: number; y: number; width: number; height: number };
}

export interface SelectionBody {
  region: { x: number; y: number; width: number; height: number };
  nodes: string[];
  elements: SelectedElement[];
  view: { theme: string; locale: string; viewport: string; group: string | null };
}

export interface SelectionOutcome {
  ok: boolean;
  message?: string;
}

/** How many elements one screen may contribute. A rectangle over a whole
 *  screen otherwise reports several hundred nested divs, which is noise a
 *  model has to pay for and read past. */
const PER_SCREEN = 14;
const TEXT_LIMIT = 120;

/** Elements inside one screen that the rectangle covers.
 *
 *  Innermost first, because the interesting element is almost always the leaf:
 *  a rectangle over a button covers the button, and also the row, the card,
 *  the section and the body. Reporting the outer ones first would bury the
 *  thing the person was pointing at.
 */
export function elementsUnder(
  nodeId: string,
  rect: { x: number; y: number; width: number; height: number },
): SelectedElement[] {
  const doc = frameDocument(nodeId);
  if (!doc) return [];

  const found: { el: Element; depth: number; box: DOMRect }[] = [];

  for (const el of doc.body.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    if (!overlaps(rect, box)) continue;
    found.push({ el, depth: depthOf(el), box });
  }

  return found
    .sort((a, b) => b.depth - a.depth)
    .slice(0, PER_SCREEN)
    .map(({ el, box }) => {
      const key = el.getAttribute('data-t') ?? undefined;
      const id = el.id || undefined;
      const classes = el.getAttribute('class') || undefined;
      const text = visibleText(el);
      return {
        node: nodeId,
        tag: el.tagName.toLowerCase(),
        ...(id ? { id } : {}),
        ...(classes ? { classes } : {}),
        ...(key ? { key } : {}),
        ...(text ? { text } : {}),
        box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
      };
    });
}

/** Script and style carry no pixels; head elements are not on screen at all. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD', 'BR']);

function frameDocument(nodeId: string): Document | null {
  const wrapper = document.querySelector(`.react-flow__node[data-id="${cssEscape(nodeId)}"]`);
  const frame = wrapper?.querySelector('iframe');
  try {
    return frame?.contentDocument ?? null;
  } catch {
    // Cross-origin one day — a selection is not worth throwing over.
    return null;
  }
}

/** The element's own text, not its descendants' — a section's textContent is
 *  the whole screen, which tells a reader nothing about the section. */
function visibleText(el: Element): string | undefined {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeType === 3) out += child.textContent ?? '';
  }
  const trimmed = out.replace(/\s+/g, ' ').trim();
  if (trimmed === '') return undefined;
  return trimmed.length > TEXT_LIMIT ? `${trimmed.slice(0, TEXT_LIMIT)}…` : trimmed;
}

function depthOf(el: Element): number {
  let depth = 0;
  let at: Element | null = el;
  while (at) {
    depth += 1;
    at = at.parentElement;
  }
  return depth;
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** CSS.escape is not in every environment this might run in, and a node id is
 *  a file basename — the characters that need escaping are few. */
const cssEscape = (s: string): string => s.replace(/["\\]/g, '\\$&');

export async function sendSelection(
  project: string,
  body: SelectionBody,
): Promise<SelectionOutcome> {
  try {
    const res = await fetch(`/selection/${project}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = (await res.json()) as { ok?: boolean; error?: string };
    if (res.ok && out.ok !== false) return { ok: true };
    return { ok: false, message: out.error ?? res.statusText };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
