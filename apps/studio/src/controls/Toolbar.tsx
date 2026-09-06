/* The three render-time switches plus the flow filter.
 *
 * Theme, locale and viewport are orthogonal axes on a node: changing one
 * re-renders in place and never makes a second node. The toolbar is just the
 * UI for that idea — it holds no state of its own.
 */

import type { ProjectDoc, RenderContext } from '@flowkit/core';

export interface ToolbarProps {
  doc: ProjectDoc;
  ctx: RenderContext;
  onCtx: (next: RenderContext) => void;
  group: string | null;
  onGroup: (next: string | null) => void;
  counts: { shown: number; total: number };
  /** Gestures the agent has not read yet. Zero hides the badge. */
  selections: number;
  /** What the canvas is laid on. Only the ground: the toolbar and the screens
   *  themselves keep their own colours, and the design's theme is a separate
   *  switch that belongs to the screens rather than to the board. */
  ground: 'dark' | 'light';
  onGround: (next: 'dark' | 'light') => void;
  /** A shared snapshot says so, rather than looking like a canvas whose
   *  dragging is mysteriously broken. */
  readOnly?: boolean;
}

export function Toolbar({
  doc,
  ctx,
  onCtx,
  group,
  onGroup,
  counts,
  selections,
  ground,
  onGround,
  readOnly,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <strong className="toolbar__name">{doc.name}</strong>
      {readOnly ? <span className="toolbar__badge">shared snapshot</span> : null}

      <Segmented
        label="Flow"
        value={group}
        options={[
          { id: null, label: 'All' },
          ...doc.flow.groups.map((g) => ({ id: g.id as string | null, label: g.label })),
        ]}
        onChange={onGroup}
      />

      <Segmented
        label="Theme"
        value={ctx.theme}
        options={Object.entries(doc.kit.themes).map(([id, t]) => ({ id, label: t.label }))}
        onChange={(theme) => onCtx({ ...ctx, theme })}
      />

      <Segmented
        label="Size"
        value={ctx.viewport}
        options={doc.viewports.map((v) => ({ id: v.id, label: v.label }))}
        onChange={(viewport) => onCtx({ ...ctx, viewport })}
      />

      <Segmented
        label="Language"
        value={ctx.locale}
        options={Object.entries(doc.strings.locales).map(([id, l]) => ({ id, label: l.label }))}
        onChange={(locale) => onCtx({ ...ctx, locale })}
      />

      {/* What the agent has not read yet. Left of the screen count because it
          is the thing that changes while you work; it disappears the moment
          the agent picks the gestures up, which is how you know it did. */}
      {selections > 0 ? (
        <span
          className="toolbar__waiting"
          title={
            `${selections} selection${selections === 1 ? '' : 's'} waiting. ` +
            'Ask about them — "why are these inconsistent?" — and the agent reads all of them.'
          }
        >
          {selections} selected
        </span>
      ) : null}

      <span className="toolbar__count">
        {counts.shown} / {counts.total} screens
      </span>

      {/* A dark design on a dark board has nothing between the screens and the
          space around them; on a light one the frames and the lines between
          them read at a glance. Muted rather than white — this is looked at
          for hours. */}
      <button
        type="button"
        className="ground"
        onClick={() => onGround(ground === 'dark' ? 'light' : 'dark')}
        title={ground === 'dark' ? 'Light board' : 'Dark board'}
        aria-label={ground === 'dark' ? 'Light board' : 'Dark board'}
      >
        {ground === 'dark' ? '◐' : '◑'}
      </button>
    </header>
  );
}

interface SegmentedProps<T extends string | null> {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
}

function Segmented<T extends string | null>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="seg">
      <span className="seg__label">{label}</span>
      <div className="seg__buttons">
        {options.map((o) => (
          <button
            key={o.id ?? '__all'}
            type="button"
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
