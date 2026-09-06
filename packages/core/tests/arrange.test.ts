import { describe, expect, test } from 'bun:test';
import type { Flow, FlowEdge, FlowNode, Viewport } from '../src/index';
import { arrange, placementOf, SNAP, stepOf, toCell, toPoint } from '../src/index';

const MOBILE: Viewport = {
  id: 'mobile',
  label: 'Mobile',
  device: 'mobile',
  width: 390,
  height: 844,
};
const DESKTOP: Viewport = {
  id: 'desktop',
  label: 'Desktop',
  device: 'desktop',
  width: 1440,
  height: 900,
};

const node = (order: number, group = 'main'): FlowNode => ({
  screen: `s${order}`,
  fixture: 'default',
  order,
  groups: group ? [group] : [],
});

const edge = (from: string, to: string, label?: string): FlowEdge => ({
  from,
  to,
  origin: 'auto',
  ...(label ? { label } : {}),
});

const flowOf = (
  nodes: Record<string, FlowNode>,
  edges: Record<string, FlowEdge>,
  groups = [{ id: 'main', label: 'Main' }],
): Flow => ({ nodes, edges, groups });

describe('a group laid out as a row', () => {
  /* The kit is a sheet, not a journey: five reference pages stacked down the
     canvas make a picture of it five screenshots tall. */
  test('places its screens side by side rather than stacked', () => {
    const flow: Flow = {
      nodes: {
        a: { screen: 'a', fixture: 'default', groups: ['kit'], order: 1 },
        b: { screen: 'b', fixture: 'default', groups: ['kit'], order: 2 },
        c: { screen: 'c', fixture: 'default', groups: ['kit'], order: 3 },
      },
      edges: {},
      groups: [{ id: 'kit', label: 'Kit', arrange: 'row' }],
    };
    const placed = arrange(flow);

    expect([placed.a, placed.b, placed.c].map((p) => p?.col)).toEqual([0, 1, 2]);
    expect(new Set([placed.a, placed.b, placed.c].map((p) => p?.lane)).size).toBe(1);
  });

  test('without the hint they stack, as a flow of roots does', () => {
    const flow: Flow = {
      nodes: {
        a: { screen: 'a', fixture: 'default', groups: ['kit'], order: 1 },
        b: { screen: 'b', fixture: 'default', groups: ['kit'], order: 2 },
      },
      edges: {},
      groups: [{ id: 'kit', label: 'Kit' }],
    };
    const placed = arrange(flow);

    expect(placed.a?.lane).not.toBe(placed.b?.lane);
  });
});

describe('arrange', () => {
  test('a straight journey reads left to right on one lane', () => {
    const at = arrange(
      flowOf({ a: node(1), b: node(2), c: node(3) }, { e1: edge('a', 'b'), e2: edge('b', 'c') }),
    );

    expect(at).toEqual({
      a: { col: 0, lane: 0 },
      b: { col: 1, lane: 0 },
      c: { col: 2, lane: 0 },
    });
  });

  /* What the layout is FOR: the success path stays on the main line and the
     failure drops out of it, so the shape of the journey is visible without
     reading a single label. */
  test('a branch drops below and the happy path stays put', () => {
    const at = arrange(
      flowOf(
        { pay: node(1), held: node(2), failed: node(3), done: node(4) },
        {
          e1: edge('pay', 'held', 'ok'),
          e2: edge('pay', 'failed', 'failed'),
          e3: edge('held', 'done'),
        },
      ),
    );

    expect(at.pay).toEqual({ col: 0, lane: 0 });
    expect(at.held).toEqual({ col: 1, lane: 0 });
    expect(at.done).toEqual({ col: 2, lane: 0 });
    expect(at.failed).toEqual({ col: 1, lane: 1 });
  });

  /* THE GUARANTEE. React Flow draws edges beneath nodes, so an edge that
     crosses a screen is invisible: the connection exists and nobody can see
     it. Every edge must therefore travel forward into the very next column,
     where nothing but corridor stands between the two ends. */
  test('every edge moves forward exactly one column', () => {
    const nodes: Record<string, FlowNode> = {
      start: node(1),
      check: node(2),
      ok: node(3),
      retry: node(4),
      fail: node(5),
      done: node(6),
    };
    const edges: Record<string, FlowEdge> = {
      e1: edge('start', 'check'),
      e2: edge('check', 'ok', 'ok'),
      e3: edge('check', 'retry', 'retry'),
      e4: edge('check', 'fail', 'failed'),
      e5: edge('ok', 'done'),
    };
    const at = arrange(flowOf(nodes, edges));

    for (const e of Object.values(edges)) {
      expect(at[e.to]!.col - at[e.from]!.col).toBe(1);
    }
  });

  test('no two screens land on the same cell', () => {
    const nodes: Record<string, FlowNode> = {};
    for (let i = 1; i <= 12; i++) nodes[`n${i}`] = node(i);
    // A wide fan: everything hangs off one step, so a naive layout stacks the
    // whole tail in a single column at a single lane.
    const edges: Record<string, FlowEdge> = {};
    for (let i = 2; i <= 12; i++) edges[`e${i}`] = edge('n1', `n${i}`, `branch ${i}`);

    const at = arrange(flowOf(nodes, edges));
    const cells = Object.values(at).map((c) => `${c.col},${c.lane}`);

    expect(new Set(cells).size).toBe(12);
  });

  test('screens with no connections at all are still placed', () => {
    const at = arrange(flowOf({ a: node(1), b: node(2), c: node(3) }, {}));

    expect(Object.keys(at).sort()).toEqual(['a', 'b', 'c']);
    expect(new Set(Object.values(at).map((c) => `${c.col},${c.lane}`)).size).toBe(3);
  });

  /* A cycle has no longest path. Layering must give up on it rather than spin,
     and the screens involved still have to appear somewhere on the canvas. */
  test('a cycle terminates and everything still gets a cell', () => {
    const at = arrange(
      flowOf(
        { a: node(1), b: node(2), c: node(3) },
        { e1: edge('a', 'b'), e2: edge('b', 'c'), e3: edge('c', 'a') },
      ),
    );

    expect(Object.keys(at).sort()).toEqual(['a', 'b', 'c']);
    expect(new Set(Object.values(at).map((c) => `${c.col},${c.lane}`)).size).toBe(3);
  });

  test('each flow gets its own band, clear of the one above', () => {
    const at = arrange(
      flowOf(
        { a: node(1, 'one'), b: node(2, 'one'), drop: node(3, 'one'), x: node(1, 'two') },
        { e1: edge('a', 'b', 'ok'), e2: edge('a', 'drop', 'failed') },
        [
          { id: 'one', label: 'One' },
          { id: 'two', label: 'Two' },
        ],
      ),
    );

    // 'one' uses lanes 0 and 1; 'two' starts clear of both.
    expect(Math.max(at.a!.lane, at.b!.lane, at.drop!.lane)).toBe(1);
    expect(at.x!.lane).toBeGreaterThan(1);
  });

  test('ungrouped screens are not left stacked at the origin', () => {
    const loose: FlowNode = { screen: 'loose', fixture: 'default', order: 1, groups: [] };
    const at = arrange(
      flowOf({ a: node(1), loose, loose2: { ...loose, screen: 'loose2', order: 2 } }, {}),
    );

    expect(at.loose!.lane).toBeGreaterThan(at.a!.lane);
    expect(`${at.loose!.col},${at.loose!.lane}`).not.toBe(`${at.loose2!.col},${at.loose2!.lane}`);
  });
});

describe('grid units to pixels', () => {
  /* The reason placement is stored in grid units at all: the same layout has
     to be right at both sizes. Stored pixels are only ever correct for the
     viewport they were measured at — which is how a hand-placed screen ends
     up on top of its neighbour the first time you switch to desktop. */
  test('one cell is one screen plus its gap, at whichever viewport', () => {
    const cell = { col: 2, lane: 1 };

    expect(toPoint(cell, MOBILE)).toEqual({ x: 2 * (390 + 180), y: 844 + 150 });
    expect(toPoint(cell, DESKTOP)).toEqual({ x: 2 * (1440 + 180), y: 900 + 150 });
  });

  test('a screen never overlaps its neighbour, at either viewport', () => {
    for (const viewport of [MOBILE, DESKTOP]) {
      const step = stepOf(viewport);
      expect(step.x).toBeGreaterThan(viewport.width);
      expect(step.y).toBeGreaterThan(viewport.height);
    }
  });

  test('a drag snaps to the grid, so corridors stay clear', () => {
    const step = stepOf(MOBILE);
    // Dropped a third of the way into column 2 — belongs in column 2.
    expect(toCell({ x: step.x * 2.1, y: step.y * 0.9 }, MOBILE)).toEqual({ col: 2, lane: 1 });
    // Dropped halfway between columns — the half-step is a legal resting place.
    expect(toCell({ x: step.x * 2.5, y: 0 }, MOBILE)).toEqual({ col: 2.5, lane: 0 });
  });

  test('a round trip through pixels comes back to the same cell', () => {
    for (const cell of [
      { col: 0, lane: 0 },
      { col: 3, lane: 2 },
      { col: 1.5, lane: 4.5 },
    ]) {
      expect(toCell(toPoint(cell, DESKTOP), DESKTOP)).toEqual(cell);
    }
  });

  test('SNAP is the granularity both ends agree on', () => {
    expect(toCell({ x: stepOf(MOBILE).x * SNAP, y: 0 }, MOBILE).col).toBe(SNAP);
  });
});

describe('placementOf', () => {
  test('a stored cell wins over anything the layout would compute', () => {
    const flow = flowOf(
      { a: { ...node(1), col: 7, lane: 3 }, b: { ...node(2), col: 8, lane: 3 } },
      { e1: edge('a', 'b') },
    );

    expect(placementOf(flow)).toEqual({ a: { col: 7, lane: 3 }, b: { col: 8, lane: 3 } });
  });

  /* A fresh import has no cells at all and still has to open readable. */
  test('unplaced nodes are arranged from the graph', () => {
    const flow = flowOf({ a: node(1), b: node(2) }, { e1: edge('a', 'b') });

    expect(placementOf(flow)).toEqual({ a: { col: 0, lane: 0 }, b: { col: 1, lane: 0 } });
  });

  /* The mixed case is the one that bites: a screen added next to screens that
     were already placed must not be dropped on top of whatever is at 0,0. */
  test('a new screen among placed ones keeps their placement and gets its own', () => {
    const flow = flowOf(
      { a: { ...node(1), col: 4, lane: 2 }, b: { ...node(2), col: 5, lane: 2 }, c: node(3) },
      { e1: edge('a', 'b'), e2: edge('b', 'c') },
    );
    const at = placementOf(flow);

    expect(at.a).toEqual({ col: 4, lane: 2 });
    expect(at.b).toEqual({ col: 5, lane: 2 });
    expect(at.c).toBeDefined();
    expect(new Set(Object.values(at).map((c) => `${c.col},${c.lane}`)).size).toBe(3);
  });
});

/* Matching only `ok` was too narrow to be useful. A flow labelled "signed in"
   and "wrong password" ranked both the same, the tie fell to document order,
   and the FAILURE took the main lane while the happy path dropped below it. */
describe('which branch is the way through', () => {
  const branchAt = (okLabel: string, badLabel: string) => {
    const at = arrange(
      flowOf(
        { step: node(1), good: node(2), bad: node(3) },
        { e1: edge('step', 'bad', badLabel), e2: edge('step', 'good', okLabel) },
      ),
    );
    return { good: at.good!.lane, bad: at.bad!.lane };
  };

  test('a success stays on the lane whatever word it uses', () => {
    for (const word of ['ok', 'signed in', 'accepted', 'paid', 'complete', 'continue']) {
      expect(branchAt(word, 'wrong password').good).toBe(0);
    }
  });

  test('a failure drops whatever word it uses', () => {
    for (const word of [
      'failed',
      'wrong password',
      'invalid code',
      'declined',
      'cancelled',
      'expired',
      'no worker',
      'timeout',
    ]) {
      const lanes = branchAt('signed in', word);
      expect(lanes.bad).toBeGreaterThan(lanes.good);
    }
  });

  /* The tie-break that produced the bug: the failure is listed FIRST in the
     document, and must still not take the main lane. */
  test('document order does not decide it', () => {
    expect(branchAt('signed in', 'wrong password')).toEqual({ good: 0, bad: 1 });
  });

  test('an unlabelled edge is still the plain next step', () => {
    const at = arrange(
      flowOf(
        { step: node(1), plain: node(2), other: node(3) },
        { e1: edge('step', 'other', 'ok'), e2: edge('step', 'plain') },
      ),
    );
    expect(at.plain!.lane).toBe(0);
    expect(at.other!.lane).toBe(1);
  });
});
