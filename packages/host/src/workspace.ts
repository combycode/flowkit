/* The projects a session can reach, and which one calls act on.
 *
 * A project is ONE FILE, and it can live anywhere. The common case is the
 * default folder; the important case is a repo, where the design belongs
 * beside the code it describes and gets committed with it.
 *
 * So there are two sources:
 *   - the default folder, scanned;
 *   - anywhere else, remembered by the registry once opened.
 *
 * Both appear in one list. Nothing distinguishes them to a caller except the
 * path shown, which is the point.
 *
 * Selection, refining the obvious "pass an id everywhere":
 *   - `project` is an OPTIONAL argument on every tool;
 *   - `open_project` sets the active one, so a run of calls costs no extra
 *     argument;
 *   - an explicit `project` always wins, so addressing another project never
 *     disturbs what the rest of the session is doing;
 *   - a lone project is selected automatically — nothing to be ambiguous
 *     about;
 *   - every write NAMES the project it changed, which is what makes the
 *     stateful part safe.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { DEFAULT_VIEWPORTS, KITS, type KitId } from '@flowkit/core';
import { exists, readJson } from './fsx';
import { workspaceDir } from './paths';
import { forget, idFromPath, knownProjects, remember } from './registry';
import { Store } from './store';

export interface ProjectMeta {
  id: string;
  name: string;
  path: string;
  screens: number;
  nodes: number;
  updatedAt: string;
}

export class Workspace {
  private readonly open = new Map<string, Store>();
  /** id -> file, for projects outside the default folder. */
  private readonly located = new Map<string, string>();
  private active: string | undefined;
  /** The id `--project` named for a file that is not there yet. Nothing but a
   *  better sentence when a tool is called before anything exists. */
  private awaiting: string | undefined;

  private constructor(private readonly dir: string) {}

  /** The folder this workspace is rooted at.
   *
   *  Public because a studio has to say WHICH workspace it is serving: two
   *  agents in two repositories both want a canvas, and adopting one another's
   *  would show each of them the other's screens. */
  get root(): string {
    return this.dir;
  }

  static async at(dir?: string): Promise<Workspace> {
    const resolved = workspaceDir(dir);
    await mkdir(resolved, { recursive: true });
    const ws = new Workspace(resolved);
    // Remembered locations are available from the first call, so a project in
    // a repo is listed without having to be re-opened by path each session.
    for (const known of await knownProjects()) ws.located.set(known.id, known.path);
    return ws;
  }

  /** Open a single file directly and make it active.
   *
   *  A path that does not exist yet is NOT an error. `--project ./design/app.json`
   *  is how somebody says where the design will live, and the first thing they
   *  do is create it — so refusing to start meant the server died before the
   *  agent could run `create_project`, and a person setting this up for the
   *  first time saw only that the MCP server had failed. The folder is made,
   *  and it becomes the place new projects go. */
  static async single(path: string): Promise<Workspace> {
    const full = resolve(path);
    if (await exists(full)) {
      const ws = await Workspace.at();
      await ws.openPath(full);
      return ws;
    }

    const dir = dirname(full);
    await mkdir(dir, { recursive: true });
    const ws = await Workspace.at(dir);
    ws.awaiting = basename(full, '.json');
    return ws;
  }

  async list(): Promise<ProjectMeta[]> {
    const ids = new Set<string>();
    for (const file of await readdir(this.dir).catch(() => [])) {
      if (file.startsWith('.')) continue; // the workspace's own bookkeeping
      if (file.endsWith('.json') && !file.endsWith('.meta.json')) ids.add(basename(file, '.json'));
    }
    for (const id of this.located.keys()) ids.add(id);
    return Promise.all([...ids].map((id) => this.meta(id)));
  }

  activeId(): string | undefined {
    return this.active;
  }

  /** The store for a call. Explicit id wins; then the active project; then, if
   *  there is exactly one, that one. */
  async require(project?: string): Promise<{ id: string; store: Store; path: string }> {
    let id = project ?? this.active;
    if (!id) {
      const known = await this.list();
      if (known.length !== 1) {
        throw new Error(
          known.length === 0
            ? this.awaiting
              ? `No project yet. This server was pointed at "${this.awaiting}" in ${this.dir}; ` +
                `create it with create_project name="…" id="${this.awaiting}".`
              : 'No projects yet. Use create_project — pass a `dir` to put it in a repo.'
            : 'No project selected. Use open_project, or pass project=<id>. ' +
                `Available: ${known.map((p) => p.id).join(', ')}.`,
        );
      }
      id = known[0]?.id;
      this.active = id;
    }
    if (!id) throw new Error('No project selected.');
    const store = await this.store(id);
    return { id, store, path: this.pathOf(id) };
  }

  /** Select by id, or open by path. A value that looks like a path is treated
   *  as one, so `open_project ./design/app.json` works without a second tool. */
  async select(idOrPath: string): Promise<ProjectMeta> {
    if (looksLikePath(idOrPath)) return this.openPath(idOrPath);
    await this.store(idOrPath);
    this.active = idOrPath;
    return this.meta(idOrPath);
  }

  /** Open a project file wherever it is, and remember where. */
  async openPath(path: string): Promise<ProjectMeta> {
    const full = resolve(path);
    if (!(await exists(full))) throw new Error(`No project file at ${full}`);

    const doc = await readJson<ProjectDoc>(full);
    // Prefer the id the document carries, unless it is a UUID. An id is what
    // someone types into `project=` and what names an export folder; a
    // 36-character hex string is useless for both, so the file name wins.
    const carried = isReadableId(doc.id) ? doc.id : idFromPath(full);
    // If that id is remembered at a path that no longer holds a file, the
    // project MOVED. Reclaim the id for its new home rather than minting a
    // `-2` duplicate and leaving a dead entry pointing at nothing — which is
    // exactly what "open the file I just relocated" used to do.
    await this.reclaimIfMoved(carried, full);
    const id = await this.freeId(carried, full);
    this.located.set(id, full);
    this.open.set(id, await Store.open({ path: full }));
    this.active = id;
    await remember({ id, path: full, name: doc.name });
    return this.meta(id);
  }

  /** Create a project. `dir` puts it anywhere — a repo, most usefully. */
  async create(name: string, dir?: string, kit: KitId = 'starter'): Promise<ProjectMeta> {
    const target = dir ? resolve(dir) : this.dir;
    await mkdir(target, { recursive: true });

    const id = await this.freeId(slug(name));
    const path = join(target, `${id}.json`);
    if (await exists(path)) throw new Error(`${path} already exists.`);

    const now = new Date().toISOString();
    await writeFile(path, JSON.stringify(newDoc(id, name, now, kit)), 'utf8');

    if (dir) this.located.set(id, path);
    this.open.set(id, await Store.open({ path }));
    this.active = id;
    await remember({ id, path, name });
    return this.meta(id);
  }

  /** Move a project's file to a new location, keeping its id. The user's own
   *  request — "store the design somewhere else" — with none of the duplicate
   *  entries that opening the relocated file by hand produced.
   *
   *  `to` is a folder (the file keeps its name) or a full `.json` path. The
   *  sidecar cache moves with it; the undo history does NOT — it is keyed to
   *  the old path and is left behind, which is the one honest cost of a move. */
  async move(id: string, to: string): Promise<ProjectMeta> {
    const from = this.pathOf(id);
    if (!(await exists(from))) throw new Error(`No file for "${id}" at ${from}.`);

    const dest = to.replace(/\\/g, '/').endsWith('.json')
      ? resolve(to)
      : join(resolve(to), basename(from));
    if (resolve(dest) === resolve(from)) return this.meta(id);
    if (await exists(dest)) throw new Error(`${dest} already exists — pick another location.`);

    await mkdir(dirname(dest), { recursive: true });
    await relocate(from, dest);
    // The cache travels too, so a move does not leave a stale summary behind.
    const fromMeta = `${from.slice(0, -5)}.meta.json`;
    if (await exists(fromMeta)) await relocate(fromMeta, `${dest.slice(0, -5)}.meta.json`);

    // Re-point: drop the open store (its path is now wrong) and the old
    // registry entry, record the new home under the same id.
    this.open.delete(id);
    this.located.set(id, dest);
    this.active = id;
    await forget(id);
    await remember({ id, path: dest, name: (await this.meta(id)).name });
    return this.meta(id);
  }

  /** Drop a remembered project from the registry. The file is untouched — this
   *  only removes the pointer, for a dead entry or one you no longer want
   *  listed. */
  async forgetProject(id: string): Promise<void> {
    this.located.delete(id);
    this.open.delete(id);
    if (this.active === id) this.active = undefined;
    await forget(id);
  }

  /** If `id` is remembered at a path that has no file, and we are opening a
   *  DIFFERENT path, the project moved: purge the dead pointer so the id is
   *  free to follow the file. */
  private async reclaimIfMoved(id: string, opening: string): Promise<void> {
    const known = this.located.get(id);
    if (!known) return;
    if (resolve(known) === resolve(opening)) return;
    if (await exists(known)) return; // a real, different project keeps its id
    this.located.delete(id);
    this.open.delete(id);
    await forget(id);
  }

  /** Write the listing cache beside the project. */
  async writeMeta(id: string): Promise<void> {
    const meta = await this.meta(id);
    const path = `${this.pathOf(id).slice(0, -5)}.meta.json`;
    await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
    await writeFile(path, JSON.stringify(meta), 'utf8').catch(() => undefined);
  }

  private async store(id: string): Promise<Store> {
    const already = this.open.get(id);
    if (already) return already;

    const path = this.pathOf(id);
    if (!(await exists(path))) {
      const known = (await this.list()).map((p) => p.id);
      throw new Error(
        `No project "${id}". Available: ${known.join(', ') || 'none'}. ` +
          'Use create_project, or open_project with a file path.',
      );
    }
    const store = await Store.open({ path });
    this.open.set(id, store);
    return store;
  }

  /** Read in order of cost: an open project is free, the cache is a few
   *  hundred bytes, the document is about a megabyte. */
  private async meta(id: string): Promise<ProjectMeta> {
    const path = this.pathOf(id);
    const opened = this.open.get(id);
    if (opened) return summarise(id, path, opened.get());

    const cachePath = `${path.slice(0, -5)}.meta.json`;
    if (await exists(cachePath)) {
      const cached = await readJson<ProjectMeta>(cachePath).catch(() => undefined);
      if (cached && typeof cached.name === 'string') return { ...cached, id, path };
    }
    return summarise(id, path, await readJson<ProjectDoc>(path));
  }

  private pathOf(id: string): string {
    return this.located.get(id) ?? join(this.dir, `${id}.json`);
  }

  /** An id not already taken by a DIFFERENT file. Re-opening the same path
   *  keeps its id rather than accumulating `-2` suffixes. */
  private async freeId(base: string, path?: string): Promise<string> {
    const taken = new Map((await this.list()).map((p) => [p.id, resolve(p.path)]));
    const mine = path ? resolve(path) : undefined;
    if (!taken.has(base) || (mine && taken.get(base) === mine)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate) || (mine && taken.get(candidate) === mine)) return candidate;
    }
  }
}

/** Move a file, falling back to copy+delete across devices.
 *
 *  `rename` is atomic but fails with EXDEV when source and destination are on
 *  different drives — moving a design from D: to a repo on C: is exactly that
 *  case, so the fallback is not optional. */
async function relocate(from: string, to: string): Promise<void> {
  const { rename, copyFile, rm } = await import('node:fs/promises');
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

/** A separator, a drive letter or a .json suffix means someone meant a file. */
const looksLikePath = (value: string): boolean =>
  value.includes('/') || value.includes('\\') || isAbsolute(value) || value.endsWith('.json');

const summarise = (id: string, path: string, doc: ProjectDoc): ProjectMeta => ({
  id,
  path,
  name: doc.name,
  screens: Object.values(doc.items).filter((i) => i.tier === 'screen').length,
  nodes: Object.keys(doc.flow.nodes).length,
  updatedAt: doc.updatedAt,
});

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project';

/** A new project starts with the minimum a screen needs to be styled at all —
 *  with no tokens the first CSS anyone wrote would be rejected. */
/** A new project is not an empty one.
 *
 *  A blank document is a blank page with a contract attached: before anything
 *  renders, someone has to invent a palette, a type scale, a reset and a house
 *  style for a button — and a model asked to design a flow will do exactly
 *  that, differently every time. The starter is a worked example to extend
 *  instead. `blank` is there for someone bringing their own system. */
const newDoc = (id: string, name: string, now: string, kit: KitId): ProjectDoc => {
  const content = KITS[kit].build();
  return {
    schema: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    kit: content.kit,
    items: content.items,
    flow: content.flow,
    strings: { defaultLocale: 'en', locales: content.locales },
    assets: {},
    viewports: DEFAULT_VIEWPORTS,
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id worth showing someone: short, and not a UUID. */
const isReadableId = (id: string | undefined): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 40 && !UUID.test(id);
