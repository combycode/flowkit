/* Saying what went wrong, where someone will see it.
 *
 * Rejections used to go to `console.error`. The command layer takes trouble
 * to explain itself — "No node named X. Available: …" — and all of that was
 * being written to a panel nobody has open. What the person saw was a screen
 * springing back to where it started, with no reason given, which reads as
 * the application being broken rather than the edit being refused.
 *
 * A bus rather than props: the things that fail are deep in the canvas and in
 * the fetch helpers, and threading a callback from the root through every one
 * of them would put UI plumbing in modules that have no other reason to know
 * a UI exists. One import, one call.
 */

export type NoticeKind = 'error' | 'info';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
  /** Something the person can do about it, when there is anything. */
  hint?: string;
}

type Listener = (notices: readonly Notice[]) => void;

/** How long each kind stays. An error waits long enough to be read twice; an
 *  acknowledgement is gone before it is in the way. */
const LINGER: Record<NoticeKind, number> = { error: 9000, info: 3500 };

let notices: Notice[] = [];
let listeners: Listener[] = [];
let nextId = 1;

export function notify(kind: NoticeKind, message: string, hint?: string): void {
  const notice: Notice = { id: nextId++, kind, message, ...(hint ? { hint } : {}) };

  // The same failure repeated — a poll against a server that has stopped —
  // should not stack up into a wall.
  notices = [...notices.filter((n) => n.message !== message), notice];
  publish();

  setTimeout(() => dismiss(notice.id), LINGER[kind]);
}

export function dismiss(id: number): void {
  const before = notices.length;
  notices = notices.filter((n) => n.id !== id);
  if (notices.length !== before) publish();
}

export function subscribe(listener: Listener): () => void {
  listeners = [...listeners, listener];
  listener(notices);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

const publish = (): void => {
  for (const listener of listeners) listener(notices);
};

/** Tests and hot reloads should not inherit whatever was on screen. */
export function reset(): void {
  notices = [];
  publish();
}
