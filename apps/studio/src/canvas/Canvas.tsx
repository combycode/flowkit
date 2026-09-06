/* The canvas. Owns React Flow wiring and nothing else — what to show comes
 * from `toFlow`, how a screen looks comes from `ScreenNode`, and what a move
 * MEANS comes from the command layer. */

import { toCell, toPoint } from '@flowkit/core';
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
  useStore,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { notify } from '../notices/bus';
import { send } from '../project/commands';
import { ScreenNode } from './ScreenNode';
import { SelectionLayer } from './SelectionLayer';
import { type ScreenNodeData, type ToFlowInput, toFlow } from './toFlow';

type Instance = ReactFlowInstance<Node<ScreenNodeData>, Edge>;

// Defined once at module scope: React Flow warns (and re-mounts every node) if
// this object identity changes between renders.
const NODE_TYPES = { screen: ScreenNode };

/** Delete as well as Backspace: Backspace alone is React Flow's default and is
 *  not what anyone reaches for. */
const DELETE_KEYS = ['Delete', 'Backspace'];

export interface CanvasProps extends ToFlowInput {
  /** Which project a move is written to. */
  project: string;
  /** What the board is laid on. Only the ground and what is drawn on it — the
   *  screens render their own theme regardless. */
  ground?: 'dark' | 'light';
  /** An exported snapshot: everything that reads stays, everything that
   *  writes goes. Filters, theme, locale and viewport are reading — they are
   *  what makes it a preview rather than a picture — so they remain. */
  readOnly?: boolean;
}

export function Canvas({
  project,
  doc,
  ctx,
  group,
  ground = 'dark',
  readOnly = false,
}: CanvasProps) {
  // Memoised on the FIELDS, not on a rest object: `{ ...input }` is a new
  // object every render, so the view would be rebuilt on every render and the
  // effect below would fire forever.
  const view = useMemo(() => toFlow({ doc, ctx, group }), [doc, ctx, group]);
  const [nodes, setNodes, onNodesChange] = useNodesState(view.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(view.edges);

  const viewport = useMemo(
    () => doc.viewports.find((v) => v.id === ctx.viewport) ?? doc.viewports[0],
    [doc.viewports, ctx.viewport],
  );

  /* A dropped screen stays where it was dropped until the document catches up.
   * The write is a round trip through a child process and the canvas only
   * notices the file changed on its next poll, so without this the node snaps
   * back to its old place for a second and then jumps forward — which reads as
   * the drag having failed. Each entry is dropped as soon as the document
   * agrees with it. */
  const pending = useRef(new Map<string, XYPosition>());

  /** Persist a drag — of one screen or of a selection.
   *
   *  Every moved screen, not just the one under the cursor: React Flow hands
   *  the dragged node as the second argument and the WHOLE dragged set as the
   *  third, so reading only the second silently drops the rest of a
   *  shift-selection and leaves the canvas disagreeing with the document. */
  const moved = useCallback(
    (dragged: readonly { id: string; position: XYPosition }[]) => {
      if (!viewport || dragged.length === 0) return;

      // Snap on the way in, so screens settle onto the grid and the corridors
      // that carry the connections stay clear of them.
      const cells = dragged.map((n) => ({ id: n.id, cell: toCell(n.position, viewport) }));
      const settled = new Map(cells.map(({ id, cell }) => [id, toPoint(cell, viewport)]));
      for (const [id, at] of settled) pending.current.set(id, at);

      setNodes((current) =>
        current.map((n) => {
          const at = settled.get(n.id);
          return at ? { ...n, position: at } : n;
        }),
      );

      /* Stored AGAINST THIS VIEWPORT, because that is the only one the person
       * was looking at while placing it. The grid step is not uniform — a
       * column is a screen width, a lane a screen height — so the same cell
       * that reads as a tidy row on a phone is three times as wide on a
       * desktop. Writing col/lane here made every careful arrangement jump the
       * moment somebody switched size.
       *
       * One request, so a selection of five screens is one entry in the op-log
       * and one undo — it was one gesture. */
      const commands = cells.map(({ id, cell }) => ({
        t: 'node.update' as const,
        id,
        patch: {
          cells: { ...(doc.flow.nodes[id]?.cells ?? {}), [viewport.id]: cell },
        },
      }));

      void send(project, commands).then((r) => {
        if (r.ok) return;
        // The move did not stick. Dropping the optimistic positions lets the
        // document put the screens back where they really are, rather than
        // leaving the canvas showing a placement that was refused.
        for (const { id } of cells) pending.current.delete(id);
        // Without this the screen simply springs back, which reads as the
        // application being broken rather than the edit being refused.
        notify(
          'error',
          cells.length === 1
            ? `Could not move ${cells[0]?.id}.`
            : `Could not move ${cells.length} screens.`,
          r.message,
        );
      });
    },
    [project, viewport, setNodes, doc],
  );

  const onNodeDragStop = useCallback(
    (
      _: unknown,
      node: { id: string; position: XYPosition },
      all: { id: string; position: XYPosition }[],
    ) => moved(all.length > 0 ? all : [node]),
    [moved],
  );

  /** Dragging a rubber-band selection reports through its own callback rather
   *  than through onNodeDragStop. */
  const onSelectionDragStop = useCallback(
    (_: unknown, all: { id: string; position: XYPosition }[]) => moved(all),
    [moved],
  );

  useEffect(() => {
    for (const n of view.nodes) {
      const optimistic = pending.current.get(n.id);
      // Within a pixel is the same place: grid maths goes through floats.
      const agreed =
        optimistic !== undefined &&
        Math.abs(optimistic.x - n.position.x) < 1 &&
        Math.abs(optimistic.y - n.position.y) < 1;
      if (agreed) pending.current.delete(n.id);
    }
    setNodes(view.nodes.map((n) => ({ ...n, position: pending.current.get(n.id) ?? n.position })));
    setEdges(view.edges);
  }, [view, setNodes, setEdges]);

  /* Connections, by hand.
   *
   * Both directions go through the command layer, and both are shown
   * immediately because React Flow has already drawn the change — waiting for
   * the file to come back round would make the canvas feel broken. A rejected
   * command restores itself on the next poll, since the document is the truth
   * and this is only a picture of it. */
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      // The same id on both sides, so the edge drawn now and the edge that
      // comes back from the document are one edge — otherwise deleting it
      // before the next poll would address something the server never had.
      const id = `edge-${c.source}-${c.target}`;
      setEdges((current) => addEdge({ ...c, id }, current));

      void send(project, { t: 'edge.connect', id, from: c.source, to: c.target }).then((r) => {
        if (!r.ok) notify('error', 'Could not connect those screens.', r.message);
      });
    },
    [project, setEdges],
  );

  const onEdgesDelete = useCallback(
    (removed: Edge[]) => {
      void send(
        project,
        removed.map((e) => ({ t: 'edge.delete' as const, id: e.id })),
      ).then((r) => {
        if (!r.ok) notify('error', 'Could not remove that connection.', r.message);
      });
    },
    [project],
  );

  // Filtering to one flow leaves that flow wherever it sits on the whole
  // canvas, which for anything but the first group is off screen — you pick a
  // flow and get an empty grid. Refit when the visible SET changes.
  //
  // Keyed on which nodes are shown and how big they are, not on `view`:
  // switching theme or language also produces a new view, and yanking the
  // camera back for a repaint would be worse than not fitting at all.
  const instance = useRef<Instance | null>(null);
  const lastShape = useRef('');
  useEffect(() => {
    const shape = view.nodes.map((n) => `${n.id}@${n.data.width}`).join('|');
    if (shape === lastShape.current || view.nodes.length === 0) return;
    lastShape.current = shape;

    // fitBounds, not fitView: fitView frames what React Flow has MEASURED, and
    // a node mounted this tick has no measurement yet, so it frames a set of
    // zero-sized points and leaves the flow a postage stamp in the corner.
    // The layout already knows every rectangle exactly — so hand it the box.
    const timer = setTimeout(() => {
      instance.current?.fitBounds(boundsOf(view.nodes), { padding: 0.12, duration: 320 });
    }, 32);
    return () => clearTimeout(timer);
  }, [view]);

  const onInit = useCallback((i: Instance) => {
    instance.current = i;
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onSelectionDragStop={onSelectionDragStop}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      onInit={onInit}
      nodeTypes={NODE_TYPES}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      edgesReconnectable={!readOnly}
      // Select a connection and press Delete or Backspace. Screens carry
      // deletable:false from `toFlow`, so the same keypress cannot lose one:
      // a screen — and the markup in it — going missing because someone
      // pressed Delete while reading is not a trade worth making. Removing a
      // screen stays deliberate, through the tools.
      deleteKeyCode={readOnly ? null : DELETE_KEYS}
      // Sixty-two live iframes at once is too many. React Flow mounts only what
      // is in view, which is what makes live documents affordable at all.
      onlyRenderVisibleElements
      minZoom={0.05}
      maxZoom={2}
      fitView
      proOptions={{ hideAttribution: false }}
    >
      <Dots ground={ground} />
      <MiniMap pannable zoomable />
      {/* The interactivity toggle would hand a snapshot's reader the dragging
          this build has deliberately taken away — and nothing would persist,
          so it would only ever mislead. */}
      <Controls showInteractive={!readOnly} />
      {/* Inside ReactFlow, so it can turn screen pixels into canvas ones.
          A snapshot has no agent to hand a selection to. */}
      {readOnly ? null : (
        <SelectionLayer
          project={project}
          theme={ctx.theme}
          locale={ctx.locale}
          viewport={ctx.viewport}
          group={group}
        />
      )}
    </ReactFlow>
  );
}

/** The dotted ground.
 *
 *  The dots are a RULER: their spacing is in canvas units, so they are how you
 *  judge at a glance that this gap is two screens wide and that one is half of
 *  it. React Flow sizes both the spacing and the dot in those units, which is
 *  right for the spacing and fatal for the dot: at 24% a 1px dot is drawn a
 *  quarter of a pixel wide, and by 6% the whole grid is a 2px mush. The ruler
 *  disappears exactly when you zoom out to use it.
 *
 *  So it works the way a map does. The dot is sized to land on about a pixel
 *  on screen whatever the zoom, and the spacing DOUBLES — 32 units, 64, 128 —
 *  until the dots are far enough apart to read as a grid. Still the design's
 *  own grid, just a coarser division of it, so distances go on comparing.
 */
function Dots({ ground }: { ground: 'dark' | 'light' }) {
  const zoom = useStore((s) => s.transform[2]);

  /** Never closer together than this on screen, or it is a wash. */
  const READABLE = 12;
  let gap = 32;
  while (gap * zoom < READABLE) gap *= 2;

  return (
    <Background
      gap={gap}
      size={Math.max(1, 1 / zoom)}
      color={ground === 'light' ? 'rgba(22, 26, 36, 0.42)' : 'rgba(255, 255, 255, 0.14)'}
    />
  );
}

/** The box every visible screen sits in. Grown a little upward and downward
 *  for the title above a node and the caption below it, which are drawn
 *  outside the frame and would otherwise be cropped by the fit. */
function boundsOf(nodes: readonly Node<ScreenNodeData>[]) {
  const CAPTION = 40;
  const left = Math.min(...nodes.map((n) => n.position.x));
  const top = Math.min(...nodes.map((n) => n.position.y));
  const right = Math.max(...nodes.map((n) => n.position.x + n.data.width));
  const bottom = Math.max(...nodes.map((n) => n.position.y + n.data.height));
  return {
    x: left,
    y: top - CAPTION,
    width: right - left,
    height: bottom - top + CAPTION * 2,
  };
}
