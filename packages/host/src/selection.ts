/* What someone pointed at.
 *
 * "Why is this cramped?" is the most natural thing to ask about a design, and
 * the hardest thing to ask an agent: the word "this" is a gesture, and a chat
 * box cannot carry one. So the gesture is recorded here, and the agent picks
 * it up on the next thing it is asked.
 *
 * A record, not a picture. The image is rendered when the agent asks for it,
 * from the document as it stands, so the answer is never about a canvas that
 * has since moved on. What IS frozen is the knobs — theme, locale, viewport,
 * flow — because those are what the person was looking at, and re-rendering
 * their selection in someone else's theme would answer a different question.
 *
 * The elements matter as much as the region. A picture lets a model say what
 * is wrong; the elements under the rectangle let it fix the right one, in the
 * right screen, without guessing from pixels.
 *
 * READING CONSUMES THEM. A selection is a gesture, and a gesture is spent once
 * it has been acted on — leaving it around means the next unrelated question
 * gets answered about a rectangle from ten minutes ago.
 *
 * They QUEUE. Pointing at three things and then asking one question about all
 * of them is ordinary, and keeping only the most recent answered about the
 * third while silently ignoring the other two.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists } from './fsx';
import { appDataDir } from './paths';

export interface SelectedElement {
  /** The node whose screen this element is in. */
  node: string;
  tag: string;
  id?: string;
  classes?: string;
  /** The string key, when the element carries one — what to change to edit
   *  its text through `set_strings` rather than through markup. */
  key?: string;
  text?: string;
  /** Position and size inside its own screen, in CSS pixels. */
  box: { x: number; y: number; width: number; height: number };
}

export interface Selection {
  project: string;
  at: string;
  /** The rectangle, in the canvas pixel coordinates `list_nodes` reports. */
  region: { x: number; y: number; width: number; height: number };
  /** Nodes the rectangle touches. */
  nodes: string[];
  elements: SelectedElement[];
  /** What the person was looking at when they drew it. */
  view: { theme: string; locale: string; viewport: string; group: string | null };
}

/** Not beside the project file: a selection is a gesture in a session, not
 *  part of the design, and committing one to a repo would be noise. */
const dir = (): string => join(appDataDir(), 'selections');

const fileOf = (project: string): string => join(dir(), `${safe(project)}.json`);

/** Project ids come from the studio's query string, so a traversal has to be
 *  impossible rather than unlikely. */
const safe = (id: string): string => id.replace(/[^\w.-]/g, '_');

/** How many gestures may be waiting. Beyond this the oldest is dropped: a
 *  person pointing at a twenty-first thing has stopped thinking about the
 *  first, and an unbounded queue is a file that grows for ever. */
const MAX = 20;

/** How long a gesture is worth acting on. A selection is a live "why is THIS
 *  cramped?", and ten minutes later the person has moved on: answering about a
 *  rectangle from earlier is worse than answering about nothing. Expired ones
 *  are pruned on every read, so a stale gesture never haunts a later question
 *  and the header count never shows one that no longer means anything. */
const TTL_MS = 10 * 60_000;

const fresh = (s: Selection): boolean => Date.now() - Date.parse(s.at) < TTL_MS;

/** Read one project's file, dropping expired entries and persisting the prune
 *  so the count the canvas polls and the queue a tool takes agree. Returns the
 *  survivors, oldest first. */
async function liveQueue(path: string): Promise<Selection[]> {
  if (!(await exists(path))) return [];
  let all: Selection[];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Selection | Selection[];
    // A file written before this was a queue holds one object.
    all = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // A half-written or hand-edited file is not worth an error: the person can
    // simply select again.
    return [];
  }
  const live = all.filter(fresh);
  if (live.length !== all.length) {
    if (live.length === 0) await rm(path, { force: true });
    else await writeFile(path, JSON.stringify(live, null, 2), 'utf8');
  }
  return live;
}

/** Every selection file currently on disk. */
async function queueFiles(): Promise<string[]> {
  const d = dir();
  if (!(await exists(d))) return [];
  return (await readdir(d)).filter((f) => f.endsWith('.json')).map((f) => join(d, f));
}

/** Add one to the queue. Returns how many are now waiting.
 *
 *  A QUEUE, not a slot. Pointing at three things and then asking one question
 *  about them is ordinary — "these three are inconsistent" — and the version
 *  that kept only the last one answered about the third and silently ignored
 *  the other two. */
export async function saveSelection(selection: Selection): Promise<number> {
  await mkdir(dir(), { recursive: true });
  const queue = [...(await peekSelections(selection.project)), selection].slice(-MAX);
  await writeFile(fileOf(selection.project), JSON.stringify(queue, null, 2), 'utf8');
  return queue.length;
}

/** Everything waiting for one project, oldest first, without consuming any of
 *  it. Expired entries are pruned as a side effect. */
export async function peekSelections(project: string): Promise<Selection[]> {
  return liveQueue(fileOf(project));
}

/** How many are waiting for one project. What the canvas shows in its header. */
export async function countSelections(project: string): Promise<number> {
  return (await peekSelections(project)).length;
}

/** Read one project's queue and clear it. */
export async function takeSelections(project: string): Promise<Selection[]> {
  const found = await peekSelections(project);
  if (found.length > 0) await clearSelection(project);
  return found;
}

/** Everything waiting across ALL projects, oldest first, without consuming any
 *  of it. A question with no named project is about whatever the person just
 *  pointed at, wherever that was — including a gesture in each of two projects
 *  to ask the model to compare them. */
export async function peekAllSelections(): Promise<Selection[]> {
  const out: Selection[] = [];
  for (const path of await queueFiles()) out.push(...(await liveQueue(path)));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Read every project's queue and clear them all. */
export async function takeAllSelections(): Promise<Selection[]> {
  const out: Selection[] = [];
  for (const path of await queueFiles()) {
    const live = await liveQueue(path);
    if (live.length > 0) {
      out.push(...live);
      await rm(path, { force: true });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function clearSelection(project: string): Promise<void> {
  await rm(fileOf(project), { force: true });
}
