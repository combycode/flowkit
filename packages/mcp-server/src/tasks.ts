/* Long jobs, run in the background.
 *
 * A full export renders 248 screens and takes minutes. Holding the request
 * open for that is wrong twice over: it blows a client's timeout, and it
 * blocks the model on something it does not need to watch. Progress
 * notifications only paper over the first problem.
 *
 * So a long tool RETURNS a task id immediately and the caller polls. The model
 * can go and do something else, come back, and read the result — which is what
 * anyone would do with a three-minute job.
 *
 * Tasks live in memory and die with the connection. A task that outlives the
 * server is a different feature (and needs a story for what happens to a
 * half-written export), so it is deliberately not one.
 */

export type TaskState = 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  kind: string;
  project: string;
  state: TaskState;
  done: number;
  total: number;
  /** What it is working on right now, for a caller that wants to say so. */
  note?: string;
  startedAt: string;
  finishedAt?: string;
  /** Summary on success — the same text the tool would have returned. */
  result?: string;
  error?: string;
}

export interface TaskHandle {
  progress(done: number, total: number, note?: string): void;
}

export class Tasks {
  private readonly tasks = new Map<string, Task>();
  private next = 1;

  /** Start `work` and return the task straight away.
   *
   *  The promise is deliberately not returned: nothing should be able to
   *  accidentally await it and reintroduce the blocking this exists to avoid. */
  start(kind: string, project: string, work: (handle: TaskHandle) => Promise<string>): Task {
    const id = `${kind}-${this.next++}`;
    const task: Task = {
      id,
      kind,
      project,
      state: 'running',
      done: 0,
      total: 0,
      startedAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);

    const handle: TaskHandle = {
      progress: (done, total, note) => {
        task.done = done;
        task.total = total;
        if (note !== undefined) task.note = note;
      },
    };

    void work(handle)
      .then((result) => {
        task.state = 'done';
        task.result = result;
      })
      .catch((err: unknown) => {
        task.state = 'failed';
        // The message a caller can act on, not a stack trace they cannot.
        task.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        task.finishedAt = new Date().toISOString();
        this.prune();
      });

    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Newest first. */
  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Keep the last 20 finished tasks. A running one is never dropped — losing
   *  the handle to a job still writing files would leave no way to find out
   *  how it ended. */
  private prune(): void {
    const finished = this.list().filter((t) => t.state !== 'running');
    for (const task of finished.slice(20)) this.tasks.delete(task.id);
  }
}

/** How long a task has been going, in a form worth reading. */
export function describe(task: Task): string {
  const elapsed = (
    (new Date(task.finishedAt ?? Date.now()).getTime() - new Date(task.startedAt).getTime()) /
    1000
  ).toFixed(1);
  const progress = task.total > 0 ? `  ${task.done}/${task.total}` : '';

  switch (task.state) {
    case 'running':
      return `${task.id}  running${progress}  ${elapsed}s${task.note ? `  ${task.note}` : ''}`;
    case 'done':
      return `${task.id}  done in ${elapsed}s\n${task.result ?? ''}`;
    case 'failed':
      return `${task.id}  FAILED after ${elapsed}s\n${task.error ?? 'no reason given'}`;
  }
}
