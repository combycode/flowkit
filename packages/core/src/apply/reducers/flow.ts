/* The `node.*`, `edge.*` and `group.*` domains — what sits on the canvas. */

import { arrange } from '../../flow/arrange';
import type { Command, Diagnostic } from '../../types/commands';
import type { FlowEdge, FlowNode, ProjectDoc } from '../../types/project';
import type { DomainReducer, Reduction } from '../../types/reducers';
import { diagnostic, unknown } from '../diagnostics';
import { freeId, inversePatch, patch, withKey, withoutKey } from '../records';

type FlowCommand = Extract<
  Command,
  { t: `node.${string}` | `edge.${string}` | `group.${string}` | `flow.${string}` }
>;

const nodeIds = (doc: ProjectDoc) => Object.keys(doc.flow.nodes);

export const flowReducer: DomainReducer<FlowCommand> = {
  domain: 'flow',

  match: (cmd): cmd is FlowCommand =>
    cmd.t.startsWith('node.') ||
    cmd.t.startsWith('edge.') ||
    cmd.t.startsWith('group.') ||
    cmd.t.startsWith('flow.'),

  precheck(doc, cmd) {
    const out: Diagnostic[] = [];

    switch (cmd.t) {
      case 'node.add':
        /* Landing on an existing node REPLACES it whole — its placement, its
         * flows, its order, its title, its meta — and says nothing. `item.create`
         * has refused a name already taken since the beginning; a node was the
         * one record that did not, purely because nobody wrote this branch.
         *
         * Safe for undo: `node.delete`'s inverse re-adds a node that is, by
         * then, gone. */
        if (cmd.id !== undefined && doc.flow.nodes[cmd.id]) {
          out.push(
            diagnostic({
              code: 'duplicate-name',
              node: cmd.id,
              message:
                `A node "${cmd.id}" is already on the canvas, showing ` +
                `"${doc.flow.nodes[cmd.id]?.screen}". Adding over it would discard where it ` +
                'sits, which flows it is in and what it is called — use update_node to change ' +
                'it, or delete_node first.',
            }),
          );
        }
        out.push(...checkNode(doc, cmd.node));
        break;

      case 'node.update': {
        const before = doc.flow.nodes[cmd.id];
        // The patch is checked as the node it WOULD produce, so an update
        // cannot sneak past a check that node.add would have caught.
        if (!before) out.push(unknown('unknown-node', 'node', cmd.id, nodeIds(doc)));
        else out.push(...checkNode(doc, patch(before, cmd.patch)));
        break;
      }

      case 'node.delete':
        if (!doc.flow.nodes[cmd.id])
          out.push(unknown('unknown-node', 'node', cmd.id, nodeIds(doc)));
        break;

      case 'edge.connect':
        for (const end of [cmd.from, cmd.to]) {
          if (!doc.flow.nodes[end]) out.push(unknown('unknown-node', 'node', end, nodeIds(doc)));
        }
        break;

      case 'edge.update':
      case 'edge.delete':
        if (!doc.flow.edges[cmd.id]) {
          out.push(unknown('unknown-node', 'edge', cmd.id, Object.keys(doc.flow.edges)));
        }
        break;

      case 'group.delete':
        if (!doc.flow.groups.some((g) => g.id === cmd.id)) {
          out.push(
            unknown(
              'unknown-group',
              'group',
              cmd.id,
              doc.flow.groups.map((g) => g.id),
            ),
          );
        }
        break;

      case 'group.set':
        break;

      case 'flow.arrange':
        if (cmd.group !== undefined && !doc.flow.groups.some((g) => g.id === cmd.group)) {
          out.push(
            unknown(
              'unknown-group',
              'group',
              cmd.group,
              doc.flow.groups.map((g) => g.id),
            ),
          );
        }
        break;
    }

    return out;
  },

  reduce(doc, cmd): Reduction {
    const flow = doc.flow;
    const withFlow = (next: Partial<typeof flow>) => ({ ...doc, flow: { ...flow, ...next } });

    switch (cmd.t) {
      case 'flow.arrange': {
        // Arranging is computed over the whole graph — a flow's shape does not
        // change because you only want to move part of it — and then applied
        // to the nodes in scope.
        const placement = arrange(flow);
        const inScope = (id: string) =>
          cmd.group === undefined || (flow.nodes[id]?.groups ?? []).includes(cmd.group);

        let nodes = flow.nodes;
        const inverse: Command[] = [];
        for (const [id, cell] of Object.entries(placement)) {
          const before = flow.nodes[id];
          if (!before || !inScope(id)) continue;

          // Nothing to say about a node that is already there.
          const settled =
            cmd.viewport === undefined
              ? before.col === cell.col && before.lane === cell.lane && before.cells === undefined
              : before.cells?.[cmd.viewport]?.col === cell.col &&
                before.cells?.[cmd.viewport]?.lane === cell.lane;
          if (settled) continue;

          /* For one viewport, or for all of them.
           *
           * Without a viewport this is a reset, so the per-viewport overrides
           * go with the shared placement — leaving them standing would put the
           * mess back the moment somebody switched size. `patch` is what
           * removes the key rather than storing an undefined in the document. */
          const after: FlowNode =
            cmd.viewport === undefined
              ? patch(before, { col: cell.col, lane: cell.lane, cells: undefined })
              : { ...before, cells: { ...before.cells, [cmd.viewport]: cell } };

          nodes = withKey(nodes, id, after);
          // `col: undefined` CLEARS rather than merges, which is what puts a
          // never-placed node back to never-placed instead of to zero.
          inverse.push({
            t: 'node.update',
            id,
            patch:
              cmd.viewport === undefined
                ? { col: before.col, lane: before.lane, cells: before.cells }
                : { cells: before.cells },
          });
        }

        return { doc: withFlow({ nodes }), inverse };
      }

      case 'node.add': {
        const id = cmd.id ?? freeId(flow.nodes, 'node-');
        return {
          doc: withFlow({ nodes: withKey(flow.nodes, id, cmd.node) }),
          inverse: [{ t: 'node.delete', id }],
        };
      }

      case 'node.update': {
        const before = flow.nodes[cmd.id];
        if (!before) return { doc, inverse: [] };
        const after = patch(before, cmd.patch);
        return {
          doc: withFlow({ nodes: withKey(flow.nodes, cmd.id, after) }),
          // NOT `patch: before` — that merges, so any key this update ADDED
          // would survive the undo. inversePatch names those keys explicitly.
          inverse: [{ t: 'node.update', id: cmd.id, patch: inversePatch(before, after) }],
        };
      }

      case 'node.delete': {
        const before = flow.nodes[cmd.id];
        if (!before) return { doc, inverse: [] };
        // An edge to a deleted node would dangle, so they go together — and
        // come back together on undo.
        const orphaned = Object.entries(flow.edges).filter(
          ([, e]) => e.from === cmd.id || e.to === cmd.id,
        );
        let edges = flow.edges;
        for (const [edgeId] of orphaned) edges = withoutKey(edges, edgeId);

        return {
          doc: withFlow({ nodes: withoutKey(flow.nodes, cmd.id), edges }),
          inverse: [
            { t: 'node.add', id: cmd.id, node: before },
            ...orphaned.map(
              ([edgeId, e]): Command => ({
                t: 'edge.connect',
                id: edgeId,
                from: e.from,
                to: e.to,
                ...(e.label !== undefined ? { label: e.label } : {}),
                // The line comes back drawn the way it was. Without this, undoing
                // a deleted screen returned its connections as plain ones.
                ...(e.style !== undefined ? { style: e.style } : {}),
              }),
            ),
          ],
        };
      }

      case 'edge.connect': {
        const id = cmd.id ?? freeId(flow.edges, 'edge-');
        const edge: FlowEdge = {
          from: cmd.from,
          to: cmd.to,
          // Stated, not inferred. Only the importer guesses, and it marks its
          // guesses 'auto' so the canvas can draw them provisionally; anything
          // a person or a model connects deliberately is an assertion.
          origin: 'authored',
          ...(cmd.label !== undefined ? { label: cmd.label } : {}),
          ...(cmd.style !== undefined ? { style: cmd.style } : {}),
        };
        return {
          doc: withFlow({ edges: withKey(flow.edges, id, edge) }),
          inverse: [{ t: 'edge.delete', id }],
        };
      }

      case 'edge.update': {
        const before = flow.edges[cmd.id];
        if (!before) return { doc, inverse: [] };
        return {
          doc: withFlow({
            edges: withKey(
              flow.edges,
              cmd.id,
              // Only the fields the command carries. Naming both unconditionally
              // meant setting a line's colour silently took its label away —
              // `patch` reads an undefined value as "remove this", which is what
              // makes clearing possible and what makes omitting dangerous.
              patch(before, {
                ...('label' in cmd ? { label: cmd.label } : {}),
                ...('style' in cmd ? { style: cmd.style } : {}),
              }),
            ),
          }),
          inverse: [
            {
              t: 'edge.update',
              id: cmd.id,
              ...(before.label !== undefined ? { label: before.label } : {}),
              ...(before.style !== undefined ? { style: before.style } : {}),
            },
          ],
        };
      }

      case 'edge.delete': {
        const before = flow.edges[cmd.id];
        if (!before) return { doc, inverse: [] };
        return {
          doc: withFlow({ edges: withoutKey(flow.edges, cmd.id) }),
          inverse: [
            {
              t: 'edge.connect',
              id: cmd.id,
              from: before.from,
              to: before.to,
              ...(before.label !== undefined ? { label: before.label } : {}),
            },
          ],
        };
      }

      case 'group.set': {
        const before = flow.groups.find((g) => g.id === cmd.group.id);
        const groups = before
          ? flow.groups.map((g) => (g.id === cmd.group.id ? cmd.group : g))
          : [...flow.groups, cmd.group];
        return {
          doc: withFlow({ groups }),
          inverse: [
            before ? { t: 'group.set', group: before } : { t: 'group.delete', id: cmd.group.id },
          ],
        };
      }

      case 'group.delete': {
        const before = flow.groups.find((g) => g.id === cmd.id);
        if (!before) return { doc, inverse: [] };
        // Drop the tag from every node too, or nodes keep pointing at a group
        // that no longer exists.
        const nodes = Object.fromEntries(
          Object.entries(flow.nodes).map(([id, n]) => [
            id,
            (n.groups ?? []).includes(cmd.id)
              ? { ...n, groups: (n.groups ?? []).filter((g) => g !== cmd.id) }
              : n,
          ]),
        );
        const tagged = Object.entries(flow.nodes)
          .filter(([, n]) => (n.groups ?? []).includes(cmd.id))
          .map(([id, n]): Command => ({ t: 'node.update', id, patch: { groups: n.groups } }));

        return {
          doc: withFlow({ groups: flow.groups.filter((g) => g.id !== cmd.id), nodes }),
          inverse: [{ t: 'group.set', group: before }, ...tagged],
        };
      }
    }
  },
};

/** A node must point at a real screen of the right tier, and at viewports,
 *  layouts and groups that exist. */
export function checkNode(doc: ProjectDoc, node: FlowNode): Diagnostic[] {
  const out: Diagnostic[] = [];
  const screens = Object.entries(doc.items)
    .filter(([, i]) => i.tier === 'screen')
    .map(([name]) => name);

  const screen = doc.items[node.screen];
  if (!screen) {
    out.push(unknown('unknown-item', 'screen', node.screen, screens));
  } else if (screen.tier !== 'screen') {
    out.push(
      diagnostic({
        code: 'wrong-tier',
        item: node.screen,
        message: `"${node.screen}" is a ${screen.tier}, not a screen. A node must point at a screen.`,
        available: screens.slice(0, 25),
      }),
    );
  }

  if (node.layout !== undefined) {
    const layouts = Object.entries(doc.items)
      .filter(([, i]) => i.tier === 'layout')
      .map(([name]) => name);
    const layout = doc.items[node.layout];
    if (!layout) out.push(unknown('unknown-item', 'layout', node.layout, layouts));
    else if (layout.tier !== 'layout') {
      out.push(
        diagnostic({
          code: 'wrong-tier',
          item: node.layout,
          message: `"${node.layout}" is a ${layout.tier}, not a layout.`,
          available: layouts.slice(0, 25),
        }),
      );
    }
  }

  if (node.viewport !== undefined && !doc.viewports.some((v) => v.id === node.viewport)) {
    out.push(
      unknown(
        'unknown-viewport',
        'viewport',
        node.viewport,
        doc.viewports.map((v) => v.id),
      ),
    );
  }

  if (screen && !screen.fixtures[node.fixture]) {
    out.push(unknown('unknown-fixture', 'fixture', node.fixture, Object.keys(screen.fixtures)));
  }

  for (const group of node.groups ?? []) {
    if (!doc.flow.groups.some((g) => g.id === group)) {
      out.push(
        unknown(
          'unknown-group',
          'group',
          group,
          doc.flow.groups.map((g) => g.id),
        ),
      );
    }
  }

  return out;
}
