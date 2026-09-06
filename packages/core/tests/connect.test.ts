import { describe, expect, test } from 'bun:test';
import type { Flow, FlowNode } from '../src/index';
import { inferEdges } from '../src/index';

const node = (screen: string, order: number, title?: string): FlowNode => ({
  screen,
  fixture: 'default',
  order,
  groups: ['main'],
  ...(title ? { title } : {}),
});

const flowOf = (entries: [string, FlowNode][]): Flow => ({
  nodes: Object.fromEntries(entries),
  edges: {},
  groups: [{ id: 'main', label: 'Main' }],
});

const pairs = (flow: Flow) =>
  Object.values(inferEdges(flow)).map((e) => `${e.from}->${e.to}${e.label ? ` (${e.label})` : ''}`);

describe('inferEdges', () => {
  test('chains ordinary steps', () => {
    const flow = flowOf([
      ['a', node('a', 1)],
      ['b', node('b', 2)],
      ['c', node('c', 3)],
    ]);
    expect(pairs(flow)).toEqual(['a->b', 'b->c']);
  });

  /* The bug this exists for: a chain through a branch point is a wrong
     statement, not a weak one. Payment succeeds OR fails; it does not succeed
     and then fail. */
  test('outcomes branch from the step, not from each other', () => {
    const flow = flowOf([
      ['budget', node('budget', 1, 'Allocate budget')],
      ['payment-success', node('payment-success', 2, 'Budget held')],
      ['payment-failed', node('payment-failed', 3, 'Payment failed')],
    ]);
    expect(pairs(flow)).toEqual([
      'budget->payment-success (ok)',
      'budget->payment-failed (failed)',
    ]);
  });

  test('and the happy path carries on from the successful one', () => {
    const flow = flowOf([
      ['budget', node('budget', 1)],
      ['payment-success', node('payment-success', 2)],
      ['payment-failed', node('payment-failed', 3)],
      ['processing', node('processing', 4)],
    ]);
    expect(pairs(flow)).toContain('payment-success->processing');
    expect(pairs(flow)).not.toContain('payment-failed->processing');
  });

  test('labels a branch with what happened', () => {
    const flow = flowOf([
      ['step', node('step', 1)],
      ['thing-declined', node('thing-declined', 2)],
    ]);
    expect(pairs(flow)).toEqual(['step->thing-declined (declined)']);
  });

  test('recognises an outcome from the title when the name does not say so', () => {
    const flow = flowOf([
      ['step', node('step', 1)],
      ['s24', node('s24', 2, 'Payment failed')],
    ]);
    expect(pairs(flow)).toEqual(['step->s24 (failed)']);
  });

  /* Every inferred edge must say so. The importer can only guess a graph from
     order and naming; a guess shown with the same weight as a decision becomes
     one. */
  test('marks every edge it produces as inferred', () => {
    const flow = flowOf([
      ['a', node('a', 1)],
      ['b', node('b', 2)],
    ]);
    expect(Object.values(inferEdges(flow)).every((e) => e.origin === 'auto')).toBe(true);
  });

  test('leaves an outcome with nothing before it unconnected', () => {
    const flow = flowOf([['lonely-error', node('lonely-error', 1)]]);
    expect(pairs(flow)).toEqual([]);
  });

  test('does not connect across flows', () => {
    const flow: Flow = {
      nodes: {
        a: { ...node('a', 1), groups: ['one'] },
        b: { ...node('b', 1), groups: ['two'] },
      },
      edges: {},
      groups: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
    };
    expect(pairs(flow)).toEqual([]);
  });
});
