/* Read-only views of the document.
 *
 * Deliberately not commands. They are the other half of the MCP surface, and
 * the half that decides token cost: `listItems` returns names and one line
 * each so a model can find what it needs, and only then pays for the full
 * item. The whole registry never goes in a prompt.
 */

import type { ItemSummary } from '../types/commands';
import type {
  EdgeId,
  FlowEdge,
  FlowNode,
  Item,
  ItemName,
  NodeId,
  ProjectDoc,
  Tier,
} from '../types/project';
import { isOpaque } from '../types/project';

export function listItems(doc: ProjectDoc, tier?: Tier): ItemSummary[] {
  return Object.entries(doc.items)
    .filter(([, item]) => tier === undefined || item.tier === tier)
    .map(([name, item]) => ({
      name,
      tier: item.tier,
      ...(item.description !== undefined ? { description: item.description } : {}),
      fixtures: Object.keys(item.fixtures),
      props: Object.keys(item.props),
      opaque: isOpaque(item),
    }));
}

export const getItem = (doc: ProjectDoc, name: ItemName): Item | undefined => doc.items[name];

export const listNodes = (doc: ProjectDoc): (FlowNode & { id: NodeId })[] =>
  Object.entries(doc.flow.nodes).map(([id, node]) => ({ id, ...node }));

export const listEdges = (doc: ProjectDoc): (FlowEdge & { id: EdgeId })[] =>
  Object.entries(doc.flow.edges).map(([id, edge]) => ({ id, ...edge }));

/** Share of an item's elements that come from the registry rather than inline
 *  markup. Reported so partial decomposition is a visible, monotonically
 *  improving number instead of a fog — and so export can refuse to emit a
 *  component library from a project that has barely begun. */
export function coverage(doc: ProjectDoc, name: ItemName): number {
  const item = doc.items[name];
  if (!item) return 0;
  const references = (item.html.match(/<x-[a-z][\w-]*/gi) ?? []).length;
  const elements = (item.html.match(/<[a-z][\w-]*/gi) ?? []).length;
  return elements === 0 ? 1 : references / elements;
}

/** Project-wide coverage, weighted by element count so a large screen counts
 *  for more than a small one. */
export function projectCoverage(doc: ProjectDoc): number {
  let references = 0;
  let elements = 0;
  for (const item of Object.values(doc.items)) {
    references += (item.html.match(/<x-[a-z][\w-]*/gi) ?? []).length;
    elements += (item.html.match(/<[a-z][\w-]*/gi) ?? []).length;
  }
  return elements === 0 ? 1 : references / elements;
}
