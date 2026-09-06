/* One screen on the canvas: title above, the live render, description below.
 *
 * The render is a `srcdoc` iframe rather than a picture. Spike A established
 * that srcdoc inherits the parent origin, which is what lets the canvas reach
 * inside a screen at all; and a live document stays crisp at any zoom,
 * switches theme and locale instantly, and can never go stale against the
 * document the way a cached thumbnail can.
 */

import { composeDocument } from '@flowkit/core';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo, useMemo, useRef } from 'react';
import type { ScreenNodeData } from './toFlow';
import { useScreenScroll } from './useScreenScroll';

/* Matches the frames in STRAIW's own contact sheet (design/index.html): a
 * phone is heavily rounded, a desktop window barely. Getting this wrong makes
 * every screen read as the wrong kind of device at a glance. */
const RADIUS = { mobile: 26, desktop: 10 } as const;

function ScreenNodeImpl({ data }: NodeProps & { data: ScreenNodeData }) {
  const { doc, ctx, item, title, description, width, height, device } = data;
  const frame = useRef<HTMLIFrameElement>(null);

  useScreenScroll(frame);

  // Composition is pure, so memoising on exactly what it reads is safe — and
  // necessary: sixty-two screens re-composing on every pan would be felt.
  const html = useMemo(() => composeDocument({ doc, item, ctx }).html, [doc, item, ctx]);

  return (
    <div className="screen-node" style={{ width }}>
      <Handle type="target" position={Position.Left} />
      <div className="screen-node__title">{title}</div>
      <div className="screen-node__frame" style={{ width, height, borderRadius: RADIUS[device] }}>
        <iframe ref={frame} title={title} srcDoc={html} width={width} height={height} />
      </div>
      {description ? <div className="screen-node__desc">{description}</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const ScreenNode = memo(ScreenNodeImpl);
