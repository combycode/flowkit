/* Alt-drag a rectangle over the canvas to point at something.
 *
 * "Why is this cramped?" is the natural question about a design and the one a
 * chat box cannot carry, because "this" is a gesture. This is the gesture. It
 * is recorded, and the agent picks it up the next time you ask it something.
 *
 * Alt rather than Shift: Shift is React Flow's own selection rectangle, and
 * taking it would cost the multi-select that already works.
 *
 * The elements under the rectangle are read out of the screens themselves.
 * That is only possible because the frames are `srcdoc`, which inherits this
 * origin — a same-origin document can be looked into. It is the difference
 * between an agent saying "something in the header looks wrong" and it naming
 * the element and the string key to change.
 */

import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notify } from '../notices/bus';
import type { SelectedElement } from '../project/selection';
import { elementsUnder, sendSelection } from '../project/selection';

export interface SelectionLayerProps {
  project: string;
  theme: string;
  locale: string;
  viewport: string;
  group: string | null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Drag = { from: { x: number; y: number }; to: { x: number; y: number } } | null;

export function SelectionLayer({ project, theme, locale, viewport, group }: SelectionLayerProps) {
  const flow = useReactFlow();
  const [armed, setArmed] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const layer = useRef<HTMLDivElement>(null);

  // Alt is held, not toggled: the layer covers the canvas while it is down, so
  // leaving it armed would block scrolling inside a screen.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        // Windows gives Alt to the menu bar otherwise, and the canvas loses
        // the keyup that would disarm this.
        e.preventDefault();
        setArmed(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setArmed(false);
    };
    // A window that loses focus mid-drag never sees the keyup.
    const blur = () => {
      setArmed(false);
      setDrag(null);
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: { x: e.clientX, y: e.clientY }, to: { x: e.clientX, y: e.clientY } });
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag) setDrag({ ...drag, to: { x: e.clientX, y: e.clientY } });
    },
    [drag],
  );

  const onPointerUp = useCallback(() => {
    if (!drag) return;
    setDrag(null);

    // Screen pixels to canvas pixels: the same coordinates list_nodes reports,
    // so a region the agent is handed can be looked at again with render_map.
    const a = flow.screenToFlowPosition(drag.from);
    const b = flow.screenToFlowPosition(drag.to);
    const region = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };

    // A click is not a selection. Anything smaller than a fingertip is one.
    if (region.width < 12 || region.height < 12) return;

    const { nodes, elements } = readUnder(region, flow.getNodes());

    void sendSelection(project, {
      region,
      nodes,
      elements,
      view: { theme, locale, viewport, group },
    }).then((r) => {
      if (r.ok) {
        notify(
          'info',
          `Selected ${nodes.length} screen${nodes.length === 1 ? '' : 's'}` +
            `${elements.length > 0 ? `, ${elements.length} elements` : ''}`,
          'Now ask the agent about it.',
        );
      } else {
        notify('error', 'Could not record that selection.', r.message);
      }
    });
  }, [drag, flow, project, theme, locale, viewport, group]);

  const box = drag ? screenBox(drag) : null;

  return (
    <div
      ref={layer}
      className="marquee-layer"
      style={{ pointerEvents: armed ? 'auto' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {box ? (
        <div
          className="marquee"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      ) : null}
    </div>
  );
}

function screenBox(drag: NonNullable<Drag>): Box {
  return {
    x: Math.min(drag.from.x, drag.to.x),
    y: Math.min(drag.from.y, drag.to.y),
    width: Math.abs(drag.from.x - drag.to.x),
    height: Math.abs(drag.from.y - drag.to.y),
  };
}

interface FlowNodeLike {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number } | undefined;
  data: Record<string, unknown>;
}

/** Which screens the rectangle touches, and what is inside them under it. */
function readUnder(
  region: Box,
  nodes: readonly FlowNodeLike[],
): { nodes: string[]; elements: SelectedElement[] } {
  const hit: string[] = [];
  const elements: SelectedElement[] = [];

  for (const node of nodes) {
    const width = numberOf(node.data.width) ?? node.measured?.width ?? 0;
    const height = numberOf(node.data.height) ?? node.measured?.height ?? 0;
    const frame = { x: node.position.x, y: node.position.y, width, height };
    if (!overlaps(region, frame)) continue;
    hit.push(node.id);

    // The rectangle, expressed inside the screen's own coordinate space.
    const local = {
      x: region.x - frame.x,
      y: region.y - frame.y,
      width: region.width,
      height: region.height,
    };
    elements.push(...elementsUnder(node.id, local));
  }

  return { nodes: hit, elements };
}

const numberOf = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
