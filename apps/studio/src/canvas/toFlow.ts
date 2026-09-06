/* ProjectDoc -> React Flow's node and edge arrays.
 *
 * Pure and separate from the component so the mapping can be tested without
 * mounting anything, and so a different canvas library later touches only
 * this file.
 */

import type { EdgeStyle, ProjectDoc, RenderContext } from '@flowkit/core';
import { placementOf, toPoint } from '@flowkit/core';
import type { Edge, Node } from '@xyflow/react';

export interface ScreenNodeData extends Record<string, unknown> {
  doc: ProjectDoc;
  ctx: RenderContext;
  item: string;
  title: string;
  description: string | undefined;
  width: number;
  height: number;
  device: 'mobile' | 'desktop';
}

export interface FlowView {
  nodes: Node<ScreenNodeData>[];
  edges: Edge[];
}

export interface ToFlowInput {
  doc: ProjectDoc;
  ctx: RenderContext;
  /** Show only nodes in this group. `null` means show everything. */
  group: string | null;
}

export function toFlow({ doc, ctx, group }: ToFlowInput): FlowView {
  const chosen = doc.viewports.find((v) => v.id === ctx.viewport) ?? doc.viewports[0];

  const visible = Object.entries(doc.flow.nodes).filter(
    ([, node]) => group === null || (node.groups ?? []).includes(group),
  );
  const ids = new Set(visible.map(([id]) => id));

  /* A node may pin its own size, and some must: a kit page is a grid of
   * variants and is unreadable in a phone frame. The toolbar chooses for
   * everything that has not said otherwise.
   *
   * The schema has always said this — "falls back to the screen's own" — and
   * the canvas was the one place that ignored it, so a screen designed at
   * 1440 was drawn at 390 and looked broken rather than pinned. */
  const sizeOf = (node: { viewport?: string; screen: string }) => {
    // A measured size wins: a generated sheet is as tall as what it shows, and
    // no viewport in the list has that number in it.
    const own = doc.items[node.screen]?.size;
    const named = node.viewport ?? doc.items[node.screen]?.viewport;
    const from = (named ? doc.viewports.find((v) => v.id === named) : undefined) ?? chosen;
    return own
      ? { ...(from ?? { id: 'own', label: 'Own', device: 'desktop' as const }), ...own }
      : from;
  };

  /* The step is the toolbar's viewport, and only that. Sizing it to the
   * LARGEST screen instead — so that a wide one could never land on its
   * neighbour — pushed sixty-two phones 1440px apart because five kit pages
   * were desktop, which is a fix that ruins the thing it protects. A screen
   * that pins a bigger viewport simply takes up more of the canvas; keeping it
   * clear of the others is a question of where it is PLACED, and build_kit
   * places its own pages with room for their size. */
  const lattice = chosen ?? {
    id: 'x',
    label: 'x',
    device: 'mobile' as const,
    width: 390,
    height: 844,
  };

  // Placement is stored in GRID units and turned into pixels here, for the
  // viewport actually being rendered. That is what lets one hand-placed
  // layout be correct at 390px and at 1440px: a stored pixel position can
  // only ever be right for the size it was measured at.
  //
  // A node nobody has placed is arranged from the connections instead, so a
  // fresh import opens readable without anything being written.
  const placed = placementOf(doc.flow, ctx.viewport);

  const nodes = visible.map(
    ([id, node]): Node<ScreenNodeData> => ({
      id,
      type: 'screen',
      // Connections are deletable from the canvas; screens are not. Delete is
      // one keypress away from a canvas people pan and read on, and a screen
      // holds markup that only exists in this document.
      deletable: false,
      position: placed[id] ? toPoint(placed[id], lattice) : { x: 0, y: 0 },
      data: {
        doc,
        ctx,
        item: node.screen,
        title: node.title ?? node.screen,
        description: node.description,
        width: sizeOf(node)?.width ?? 390,
        height: sizeOf(node)?.height ?? 844,
        device: sizeOf(node)?.device ?? 'mobile',
      },
    }),
  );

  // An edge whose other end is filtered out would render as a line to nowhere,
  // so it is hidden with its node rather than left dangling.
  const edges = Object.entries(doc.flow.edges)
    .filter(([, e]) => ids.has(e.from) && ids.has(e.to))
    .map(
      ([id, e]): Edge => ({
        id,
        source: e.from,
        target: e.to,
        // An inferred connection is drawn provisionally. The importer can only
        // guess a graph from screen order and naming, and a guess shown with
        // the same weight as a decision becomes one.
        ...(e.origin === 'auto' ? { className: 'edge--assumed' } : {}),
        ...(e.label ? { label: e.label } : {}),
        // Said outright, so it wins over the class an assumed edge carries:
        // a connection somebody styled deliberately is a statement, and the
        // provisional look is for the ones nobody has.
        ...(e.style ? { style: strokeOf(e.style) } : {}),
      }),
    );

  return { nodes, edges };
}

/** A stored edge style as the canvas draws it.
 *
 *  Only what was actually said: an absent width must stay absent rather than
 *  become a hard-coded default, or every unstyled connection on the map would
 *  start overriding the theme it is drawn in. */
function strokeOf(style: EdgeStyle): Record<string, string | number> {
  return {
    ...(style.width !== undefined ? { strokeWidth: style.width } : {}),
    ...(style.color !== undefined ? { stroke: style.color } : {}),
    ...(style.dash ? { strokeDasharray: '6 5' } : {}),
  };
}
