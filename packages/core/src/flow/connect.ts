/* Default connections for a freshly imported project.
 *
 * The first version chained each flow by `order`, which is a WRONG statement
 * rather than a weak one. In the Awaiting flow that produced
 *
 *     budget -> payment-success -> payment-failed -> processing
 *
 * when the truth is that budget branches to both outcomes and only success
 * continues. A chain through a branch point misrepresents the design.
 *
 * So outcome screens are recognised and fan out from the step before them.
 * That is a heuristic: the source carries an order and a caption, never a
 * graph, and no rule recovers a graph that was never written down. Every edge
 * produced here is therefore marked `origin: 'auto'` — drawn provisionally on
 * the canvas, labelled as assumed in an export, and replaceable wholesale
 * without touching a connection a person or a model actually drew.
 *
 * The point is not to be right. It is to be visibly a guess, and to be right
 * often enough to be worth having.
 */

import type { EdgeId, Flow, FlowEdge, FlowNode } from '../types/project';

/** A screen that reports how something turned out, rather than a step someone
 *  walks through. These branch from the step before them instead of following
 *  one another. */
const OUTCOME =
  /(success|failed|failure|error|declin|reject|cancel|no-worker|already-taken|expired|thank-you)/i;

/** An outcome the happy path continues from. */
const CONTINUES = /(success|complete|ready|done|accepted|paid|thank-you)/i;

const isOutcome = (id: string, node: FlowNode): boolean =>
  OUTCOME.test(id) || OUTCOME.test(node.title ?? '');

const continuesFrom = (id: string, node: FlowNode): boolean =>
  CONTINUES.test(id) || CONTINUES.test(node.title ?? '');

export function inferEdges(flow: Flow): Record<EdgeId, FlowEdge> {
  const out: Record<EdgeId, FlowEdge> = {};

  for (const group of flow.groups) {
    const members = Object.entries(flow.nodes)
      .filter(([, n]) => (n.groups ?? []).includes(group.id))
      .sort(([idA, a], [idB, b]) => {
        const oa = a.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.order ?? Number.MAX_SAFE_INTEGER;
        return oa === ob ? idA.localeCompare(idB) : oa - ob;
      });

    /** The last step screen — what an outcome branches from. */
    let step: string | undefined;
    /** A positive outcome the next step should follow instead of the step. */
    let resume: string | undefined;

    for (const [id, node] of members) {
      if (isOutcome(id, node)) {
        // Branch from the step, not from the outcome before it: two outcomes
        // of one decision are siblings, not a sequence.
        if (step) add(out, group.id, step, id, outcomeLabel(id, node));
        if (!resume && continuesFrom(id, node)) resume = id;
        continue;
      }

      const from = resume ?? step;
      if (from) add(out, group.id, from, id);
      step = id;
      resume = undefined;
    }
  }

  return out;
}

/** A short word for what happened, so a branch reads as a branch. */
function outcomeLabel(id: string, node: FlowNode): string {
  const source = `${id} ${node.title ?? ''}`;
  const match = OUTCOME.exec(source);
  if (!match) return '';
  const word = (match[1] ?? '').toLowerCase();
  if (/success|paid|accepted|complete|thank-you/.test(word)) return 'ok';
  if (/failed|failure|error/.test(word)) return 'failed';
  if (/declin|reject/.test(word)) return 'declined';
  if (/cancel/.test(word)) return 'cancelled';
  return word.replace(/-/g, ' ');
}

function add(
  out: Record<EdgeId, FlowEdge>,
  group: string,
  from: string,
  to: string,
  label = '',
): void {
  out[`${group}:${from}->${to}`] = {
    from,
    to,
    // Marked so it can be told apart from a connection someone meant.
    origin: 'auto',
    ...(label ? { label } : {}),
  };
}

/** Kept as the old name so an import that wanted a plain chain still has one. */
export const sequentialEdges = inferEdges;
