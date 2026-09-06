/* The notice bus. Small, but it is the only thing standing between a refused
 * edit and a person concluding the application is broken. */

import { afterEach, describe, expect, test } from 'bun:test';
import { dismiss, type Notice, notify, reset, subscribe } from '../src/notices/bus';

const seen = (): { current: readonly Notice[]; stop: () => void } => {
  const box: { current: readonly Notice[]; stop: () => void } = {
    current: [],
    stop: () => undefined,
  };
  box.stop = subscribe((notices) => {
    box.current = notices;
  });
  return box;
};

afterEach(() => {
  reset();
});

describe('notices', () => {
  test('a subscriber is told what is already showing', () => {
    notify('error', 'Already here');
    const box = seen();

    expect(box.current.map((n) => n.message)).toEqual(['Already here']);
    box.stop();
  });

  test('a notice carries the diagnostic as its hint', () => {
    const box = seen();
    notify('error', 'Could not move a screen.', 'No node named "ghost".');

    expect(box.current[0]?.hint).toBe('No node named "ghost".');
    expect(box.current[0]?.kind).toBe('error');
    box.stop();
  });

  /* A poll against a server that has stopped fails every second and a half.
     Stacking those would bury the canvas in a wall of the same sentence. */
  test('the same message repeated replaces itself rather than stacking', () => {
    const box = seen();
    notify('error', 'Lost contact.');
    notify('error', 'Lost contact.');
    notify('error', 'Lost contact.');

    expect(box.current).toHaveLength(1);
    box.stop();
  });

  test('different messages all show', () => {
    const box = seen();
    notify('error', 'One');
    notify('info', 'Two');

    expect(box.current).toHaveLength(2);
    box.stop();
  });

  test('a notice can be dismissed', () => {
    const box = seen();
    notify('info', 'Passing');
    const id = box.current[0]?.id;
    expect(id).toBeDefined();

    dismiss(id as number);
    expect(box.current).toHaveLength(0);
    box.stop();
  });

  test('dismissing something already gone is harmless', () => {
    const box = seen();
    dismiss(9999);
    expect(box.current).toHaveLength(0);
    box.stop();
  });

  test('unsubscribing stops the updates', () => {
    const box = seen();
    box.stop();
    notify('error', 'After unsubscribe');

    expect(box.current).toHaveLength(0);
  });
});
