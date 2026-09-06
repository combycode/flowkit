/* Arranging screens by the flow, not by a grid.
 *
 * Rows and columns in reading order say nothing about the journey. The graph
 * already knows the journey, so the layout follows it: the happy path runs
 * left to right along one lane, and a branch drops to the lane below.
 *
 * THE PROPERTY THAT MATTERS: an edge must not pass under a screen. React Flow
 * draws edges beneath nodes, so an edge crossing a screen is simply invisible
 * — the connection is there and nobody can see it.
 *
 * The layout guarantees this rather than hoping for it. Every screen sits in a
 * COLUMN, columns are separated by a corridor, and an edge from one column to
 * the next travels entirely inside that corridor: out of the right edge of the
 * source, into the left edge of the target, never crossing the vertical band
 * where a screen sits. Depths come from LONGEST-path layering, so an edge
 * always moves forward at least one column; with a graph shaped like this one
 * that is almost always exactly one.
 *
 * The result is in GRID units, not pixels — see `toPoint`. Pixels belong to a
 * viewport, and a layout is not about any particular viewport.
 *
 * Pure, and returns a placement rather than mutating: the same function serves
 * the canvas, an import step and the rearrange command.
 */

import type { Flow, FlowEdge, FlowNode, NodeId, Viewport } from '../types/project';

/** Where a screen sits, in grid units. One column is a screen width plus the
 *  corridor; one lane is a screen height plus the room for its captions.
 *
 *  Fractions are legal — a hand-placed screen lands on a half-step. */
export interface Cell {
  col: number;
  lane: number;
}

export type Placement = Record<NodeId, Cell>;

/** How much room the grid leaves around a screen, in pixels.
 *
 *  `gapX` is the corridor every edge travels through, so it has to be wide
 *  enough to read a label in. `gapY` leaves space for the title above a screen
 *  and the caption below it. */
export const GRID = { gapX: 180, gapY: 150 } as const;

/** Separation between one flow and the next, in lanes. Half a lane reads as a
 *  break without wasting a whole screen height of canvas. */
const GROUP_GAP = 0.5;

/** The finest placement the canvas offers. Snapping to it keeps the corridors
 *  between columns clear, so a screen dragged by hand cannot come to rest on
 *  top of a connection and hide it. */
export const SNAP = 0.5;

export interface Grid {
  gapX?: number;
  gapY?: number;
}

/** Grid units to pixels, for the viewport actually being rendered. */
export function toPoint(cell: Cell, viewport: Viewport, grid: Grid = {}): { x: number; y: number } {
  const step = stepOf(viewport, grid);
  return { x: cell.col * step.x, y: cell.lane * step.y };
}

/** Pixels back to grid units, snapped — what a finished drag becomes. */
export function toCell(point: { x: number; y: number }, viewport: Viewport, grid: Grid = {}): Cell {
  const step = stepOf(viewport, grid);
  return { col: snap(point.x / step.x), lane: snap(point.y / step.y) };
}

export function stepOf(viewport: Viewport, grid: Grid = {}): { x: number; y: number } {
  return {
    x: viewport.width + (grid.gapX ?? GRID.gapX),
    y: viewport.height + (grid.gapY ?? GRID.gapY),
  };
}

const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

export function arrange(flow: Flow): Placement {
  const out: Placement = {};
  let top = 0;

  for (const group of groupsOf(flow)) {
    const members = membersOf(flow, group);
    if (members.length === 0) continue;

    const row = flow.groups.find((g) => g.id === group)?.arrange === 'row';
    const placed = row
      ? members.map(([id], i) => ({ id, col: i, lane: 0 }))
      : placeGroup(members, edgesWithin(flow, new Set(members.map(([id]) => id))));
    const lanes = Math.max(...placed.map((p) => p.lane)) + 1;

    for (const { id, col, lane } of placed) out[id] = { col, lane: top + lane };
    top += lanes + GROUP_GAP;
  }

  return out;
}

/** Declared flows, then a final pass for anything ungrouped so no node is
 *  silently left at the origin. */
function groupsOf(flow: Flow): (string | null)[] {
  const declared = flow.groups.map((g) => g.id);
  const loose = Object.values(flow.nodes).some((n) => (n.groups ?? []).length === 0);
  return loose ? [...declared, null] : declared;
}

const membersOf = (flow: Flow, group: string | null): [NodeId, FlowNode][] =>
  Object.entries(flow.nodes)
    .filter(([, n]) =>
      group === null ? (n.groups ?? []).length === 0 : (n.groups ?? []).includes(group),
    )
    .sort(([idA, a], [idB, b]) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa === ob ? idA.localeCompare(idB) : oa - ob;
    });

const edgesWithin = (flow: Flow, ids: ReadonlySet<NodeId>): FlowEdge[] =>
  Object.values(flow.edges).filter((e) => ids.has(e.from) && ids.has(e.to));

interface Placed extends Cell {
  id: NodeId;
}

function placeGroup(members: [NodeId, FlowNode][], edges: readonly FlowEdge[]): Placed[] {
  const ids = members.map(([id]) => id);
  const order = new Map(ids.map((id, i) => [id, i]));

  const successors = new Map<NodeId, NodeId[]>(ids.map((id) => [id, []]));
  const indegree = new Map<NodeId, number>(ids.map((id) => [id, 0]));
  for (const e of edges) {
    successors.get(e.from)?.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  // The happy path continues along the current lane, so it must come first.
  const primaryFirst = (from: NodeId) =>
    [...(successors.get(from) ?? [])].sort((a, b) => {
      const rank = (to: NodeId) =>
        rankOf(edges.find((e) => e.from === from && e.to === to)?.label ?? '');
      return rank(a) - rank(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0);
    });

  const col = longestPathColumns(ids, successors, indegree, order);
  const preferred = preferredLanes(ids, col, primaryFirst, indegree, order);

  return assignLanes(ids, col, preferred, order);
}

/* What a label says about whether this is the way through.
 *
 * Matching only `ok` was too narrow to be useful: a flow labelled "signed in"
 * and "wrong password" ranked both the same, the tie fell to document order,
 * and the FAILURE took the main lane while the happy path dropped below it —
 * which reads as exactly the opposite of what the design says.
 *
 * Word-based rather than exact, because these are labels people write. An
 * unlabelled edge is the plain next step and still wins outright. */
const SUCCEEDS =
  /\b(ok|yes|success|succeeded|signed[ -]?in|continue|done|complete[d]?|accept(ed)?|approved|paid|next)\b/i;
const FAILS =
  /\b(fail(ed|ure)?|error|wrong|invalid|incorrect|denied|declin(e|ed)|reject(ed)?|cancel(led)?|expired|unavailable|missing|no[ -]\w+|not[ -]\w+|timeout|blocked)\b/i;

function rankOf(label: string): number {
  if (label === '') return 0; // the plain next step
  if (FAILS.test(label)) return 3; // drops furthest
  if (SUCCEEDS.test(label)) return 1;
  return 2;
}

/** Longest-path layering: a node sits one past the furthest thing leading to
 *  it, so every edge moves forward and none points backwards. */
function longestPathColumns(
  ids: readonly NodeId[],
  successors: ReadonlyMap<NodeId, NodeId[]>,
  indegree: ReadonlyMap<NodeId, number>,
  order: ReadonlyMap<NodeId, number>,
): Map<NodeId, number> {
  const col = new Map<NodeId, number>(ids.map((id) => [id, 0]));
  const remaining = new Map(indegree);
  const queue = ids.filter((id) => (remaining.get(id) ?? 0) === 0);
  const seen = new Set<NodeId>(queue);

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const next of successors.get(id) ?? []) {
      col.set(next, Math.max(col.get(next) ?? 0, (col.get(id) ?? 0) + 1));
      remaining.set(next, (remaining.get(next) ?? 1) - 1);
      if ((remaining.get(next) ?? 0) === 0 && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  // Anything left is in a cycle. Falling back to its position in the flow
  // keeps it on screen instead of stacking it at the origin.
  for (const id of ids) {
    if (!seen.has(id)) col.set(id, order.get(id) ?? 0);
  }
  return col;
}

/** Where each node would like to sit vertically: the main line stays put, a
 *  branch drops one lane per alternative. */
function preferredLanes(
  ids: readonly NodeId[],
  col: ReadonlyMap<NodeId, number>,
  primaryFirst: (from: NodeId) => NodeId[],
  indegree: ReadonlyMap<NodeId, number>,
  order: ReadonlyMap<NodeId, number>,
): Map<NodeId, number> {
  const lane = new Map<NodeId, number>();

  // Roots stack downwards; a flow usually has one, but nothing guarantees it.
  const roots = ids
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  roots.forEach((id, i) => {
    lane.set(id, i);
  });

  // In column order, so a node is placed after whatever leads to it.
  for (const id of [...ids].sort((a, b) => (col.get(a) ?? 0) - (col.get(b) ?? 0))) {
    const here = lane.get(id) ?? 0;
    primaryFirst(id).forEach((next, i) => {
      const want = here + i;
      // Nearest to the main line wins: a screen reachable both directly and
      // through a branch belongs on the through-line.
      lane.set(next, Math.min(lane.get(next) ?? Number.POSITIVE_INFINITY, want));
    });
  }

  for (const id of ids) if (!lane.has(id)) lane.set(id, 0);
  return lane;
}

/** Turn preferences into positions no two nodes share.
 *
 *  Two screens in one column at one lane would sit on top of each other, so
 *  within a column each takes the next free lane at or below what it wanted. */
function assignLanes(
  ids: readonly NodeId[],
  col: ReadonlyMap<NodeId, number>,
  preferred: ReadonlyMap<NodeId, number>,
  order: ReadonlyMap<NodeId, number>,
): Placed[] {
  const byColumn = new Map<number, NodeId[]>();
  for (const id of ids) {
    const c = col.get(id) ?? 0;
    byColumn.set(c, [...(byColumn.get(c) ?? []), id]);
  }

  const out: Placed[] = [];
  for (const [c, members] of byColumn) {
    const sorted = [...members].sort(
      (a, b) =>
        (preferred.get(a) ?? 0) - (preferred.get(b) ?? 0) ||
        (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );
    let lastUsed = -1;
    for (const id of sorted) {
      const lane = Math.max(preferred.get(id) ?? 0, lastUsed + 1);
      lastUsed = lane;
      out.push({ id, col: c, lane });
    }
  }
  return out;
}

/** Every node's cell: what is stored where it exists, arranged where it does
 *  not. The canvas asks for this rather than choosing between the two itself,
 *  so a fresh import opens readable without anything being persisted, and a
 *  placement someone made by hand is never quietly recomputed away.
 *
 *  Arranging runs over the WHOLE flow even when only one node lacks a cell: a
 *  lone new screen placed relative to nothing would land on top of whatever
 *  sits at the origin. */
export function placementOf(flow: Flow, viewport?: string): Placement {
  const stored: Placement = {};
  let missing = false;

  for (const [id, node] of Object.entries(flow.nodes)) {
    /* A placement made FOR this viewport wins, because it is the only one
     * anybody looked at while making it. col/lane is the shared default for
     * every viewport nobody has arranged. */
    const own = viewport === undefined ? undefined : node.cells?.[viewport];
    if (own) {
      stored[id] = own;
    } else if (node.col !== undefined && node.lane !== undefined) {
      stored[id] = { col: node.col, lane: node.lane };
    } else {
      missing = true;
    }
  }
  if (!missing) return stored;

  return { ...arrange(flow), ...stored };
}
