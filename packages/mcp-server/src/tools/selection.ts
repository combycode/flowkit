/* get_selection — picking up what someone pointed at.
 *
 * "Why is this cramped?" is the natural question about a design and the one a
 * chat box cannot carry, because "this" is a gesture. Alt-drag on the canvas
 * records the gesture; this hands it over: the picture, the screens it covers,
 * and the actual elements under it.
 *
 * The elements are the part that turns an answer into an edit. A picture lets
 * a model say the spacing looks wrong; `p.brief__note[data-t=…]` lets it
 * change the right thing in the right screen.
 *
 * The image is rendered NOW, from the document as it stands, so a selection
 * cannot answer for a canvas that has since moved on. The view is not: theme,
 * locale, viewport and flow are frozen at the moment of the gesture, because
 * re-rendering someone's selection in a different theme answers a different
 * question from the one they asked.
 *
 * ALL of them are returned, oldest first. Pointing at three things and then
 * asking one question about them is ordinary — "these three are inconsistent"
 * — and the version that kept only the most recent answered about the third
 * while silently ignoring the other two.
 *
 * Reading CONSUMES them. A gesture is spent once it has been acted on; leaving
 * them behind means the next unrelated question is answered about a rectangle
 * from ten minutes ago.
 */

import type { ProjectDoc } from '@flowkit/core';
import type { Selection, Sidecar } from '@flowkit/host';
import { mapPage, peekSelections, READY_FLAG, takeSelections, type Workspace } from '@flowkit/host';
import { z } from 'zod';
import { type ToolReply, text } from '../reply';
import { type Registrar, registerBare, type ToolSpec } from './registrar';

export function registerSelectionTools(server: Registrar, ws: Workspace, sidecar: Sidecar): void {
  registerBare(server, tools(ws, sidecar));
}

/** How many pictures one call will render.
 *
 *  A person can point at twenty things; twenty screenshots is a minute of
 *  rendering and more image tokens than the answer is worth. The rest are
 *  still described in text, so nothing is lost silently. */
const PICTURES = 6;

function tools(ws: Workspace, sidecar: Sidecar): ToolSpec[] {
  return [
    {
      name: 'get_selection',
      config: {
        title: 'What the user pointed at',
        description:
          'Alt-dragging a rectangle on the canvas records a selection. This returns every ' +
          'one that is waiting, oldest first: a picture of each region, the screens it ' +
          'covers, and the elements under it with their classes, string keys and text. ' +
          'CALL IT WHENEVER A QUESTION USES A WORD LIKE "this", "here", "these" or "that" ' +
          'without saying which screen — those are gestures, and this is where they are. ' +
          'Several waiting usually means ONE question about all of them. ' +
          'Reading consumes them, so call it once per question.',
        inputSchema: { project: z.string().optional(), peek: z.boolean().optional() },
      },
      run: async (args: { project?: string; peek?: boolean }): Promise<ToolReply> => {
        const { id, store } = await ws.require(args.project);

        const waiting = args.peek ? await peekSelections(id) : await takeSelections(id);
        if (waiting.length === 0) {
          return text(
            `Nothing selected in ${id}. Alt-drag a rectangle on the canvas to point at ` +
              'something, then ask again.',
          );
        }

        const doc = store.get();
        const content: ToolReply['content'] = [];

        if (waiting.length > 1) {
          content.push({
            type: 'text',
            text:
              `${waiting.length} selections were waiting, oldest first. Unless the person ` +
              'said otherwise, treat them as one question about all of them.',
          });
        }

        for (const [index, selection] of waiting.entries()) {
          const label = waiting.length > 1 ? `Selection ${index + 1} of ${waiting.length}. ` : '';
          const shot = index < PICTURES ? await render(sidecar, doc, selection) : undefined;

          if (typeof shot === 'string') {
            content.push({ type: 'text', text: `${label}${shot}` });
            continue;
          }

          content.push({
            type: 'text',
            text: label + describe(selection, id, shot?.width ?? 0, shot?.height ?? 0),
          });
          if (shot) content.push({ type: 'image', data: shot.data, mimeType: 'image/png' });
        }

        if (waiting.length > PICTURES) {
          content.push({
            type: 'text',
            text:
              `${waiting.length - PICTURES} more selections are described above without a ` +
              'picture. Ask again after acting on these, or point at fewer things at once.',
          });
        }

        return { content };
      },
    },
  ];
}

/** One selection photographed, or the reason it could not be. */
async function render(
  sidecar: Sidecar,
  doc: ProjectDoc,
  selection: Selection,
): Promise<{ data: string; width: number; height: number } | string> {
  const map = mapPage({
    doc,
    ctx: {
      theme: selection.view.theme,
      locale: selection.view.locale,
      viewport: selection.view.viewport,
    },
    ...(selection.view.group ? { group: selection.view.group } : {}),
    // Everything the canvas had. Dropping the kit here — as a map does,
    // because a map is about journeys — moved every coordinate after it and a
    // rectangle drawn over a kit page came back as a picture of the first
    // screen in the flow.
    generated: true,
  });
  if (map.screens === 0) return 'The flow this was selected in has no screens on it any more.';

  /* The canvas is infinite; the page is only as big as its screens plus a
   * margin. So a rectangle drawn with room to spare around a screen starts
   * left of the page, and a clip with a negative origin is not a clip Chromium
   * honours — it silently photographs the top-left corner of the document
   * instead, which comes back as a picture of an entirely different screen.
   *
   * Clamped to what exists, so the answer is the part of the gesture there was
   * something to answer about. */
  const clip = within(
    {
      x: selection.region.x - map.bounds.x,
      y: selection.region.y - map.bounds.y,
      width: selection.region.width,
      height: selection.region.height,
    },
    map.bounds,
  );
  if (clip.width < 1 || clip.height < 1) {
    return 'That rectangle is off the edge of the design — there are no screens under it.';
  }

  return await sidecar.render({
    html: map.html,
    width: Math.min(2000, Math.ceil(clip.width)),
    height: Math.min(2000, Math.ceil(clip.height)),
    clip,
    // A selection is usually small enough to read at 1:1, and a person asking
    // about a detail wants the detail.
    scale: fitScale(clip.width, clip.height),
    scrollToEnd: false,
    waitFor: `window.${READY_FLAG}`,
  });
}

/** The part of a rectangle that is actually on the page. */
export function within(
  clip: { x: number; y: number; width: number; height: number },
  bounds: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, clip.x);
  const y = Math.max(0, clip.y);
  return {
    x,
    y,
    width: Math.min(clip.x + clip.width, bounds.width) - x,
    height: Math.min(clip.y + clip.height, bounds.height) - y,
  };
}

function describe(s: Selection, project: string, w: number, h: number): string {
  const region =
    `x=${Math.round(s.region.x)} y=${Math.round(s.region.y)} ` +
    `w=${Math.round(s.region.width)} h=${Math.round(s.region.height)}`;

  const lines = [
    `Selected in ${project} at ${s.at}.`,
    `Region ${region} in canvas pixels — ${s.view.theme}, ${s.view.locale}, ` +
      `${s.view.viewport}${s.view.group ? `, flow ${s.view.group}` : ''}.` +
      `${w > 0 ? ` Image ${w}x${h}.` : ' No picture for this one.'}`,
    s.nodes.length > 0 ? `Screens: ${s.nodes.join(', ')}.` : 'No screen under it — empty canvas.',
  ];

  if (s.elements.length > 0) {
    lines.push('', 'Elements under the rectangle, innermost first:');
    for (const el of s.elements) {
      lines.push(
        `  ${el.node}  <${el.tag}` +
          `${el.id ? ` id="${el.id}"` : ''}` +
          `${el.classes ? ` class="${el.classes}"` : ''}` +
          `${el.key ? ` data-t="${el.key}"` : ''}>` +
          `  ${el.box.width}x${el.box.height} at ${el.box.x},${el.box.y}` +
          `${el.text ? `  "${el.text}"` : ''}`,
      );
    }
    lines.push(
      '',
      'A data-t value is a string key: change that text with set_strings rather than by ' +
        'editing markup, or every other locale silently keeps the old wording.',
    );
  }

  return lines.join('\n');
}

/** Read at 1:1 unless the rectangle is genuinely large. */
function fitScale(width: number, height: number): number {
  const LONGEST = 2000;
  return Math.min(1, LONGEST / Math.max(width, height));
}
