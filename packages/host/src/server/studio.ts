/* The local server: the studio, and the two endpoints it writes through.
 *
 * This replaces a Vite dev server, and the change is not cosmetic. Vite loads
 * its config in Node and externalises workspace packages, so the endpoints had
 * to live in middleware that could not import a Store — every write shelled
 * out to a child process, and the studio and the MCP server ended up as two
 * writers on one file, each with its own op-log and its own idea of undo.
 *
 * Here they are ONE process. The MCP server and the canvas share a Workspace,
 * so a screen you drag and a screen an agent moves are the same operation on
 * the same store, in one history. That is worth more than the dev server's
 * hot reload.
 *
 * It serves the same bundle an exported snapshot carries. Over HTTP the page
 * fetches its project and can write; from a file it reads the document baked
 * into it and cannot. One application, told apart by where the document came
 * from — see `sourceOf` in the studio.
 *
 * LOOPBACK ONLY, and origin-checked. This writes to files on the machine it
 * runs on, and a page on any website can make a browser POST to localhost.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Command } from '@flowkit/core';
import { exists } from '../fsx';
import { DEFAULT_PORT } from '../paths';
import { countSelections, type Selection, saveSelection } from '../selection';
import { findViewerBundle } from '../viewer-bundle';
import type { Workspace } from '../workspace';

export interface ServeOptions {
  workspace: Workspace;
  /** First port to try. Later ports are tried if it is taken by something
   *  that is not us. */
  port?: number;
  /** Where `viewer.js` and `viewer.css` are. Defaults to the studio build. */
  bundleDir?: string;
}

export interface Studio {
  url: string;
  port: number;
  /** True when another instance already owned the port and this call did not
   *  start a server. Two Claude Code sessions should not fight over it. */
  adopted: boolean;
  stop(): void;
}

const HOST = '127.0.0.1';
/** How many ports to walk before giving up. */
const TRIES = 10;

/** Answered by `/health` so a second instance can recognise a first. */
const IDENT = 'flowkit-studio';

export async function serveStudio(options: ServeOptions): Promise<Studio> {
  const first = options.port ?? DEFAULT_PORT;
  // May be undefined — in the repo before build:viewer, say. The asset handler
  // then answers 503 with how to build it, rather than the server refusing to
  // start: an agent without a canvas still reads and writes the design.
  const bundleDir = options.bundleDir ?? findViewerBundle(import.meta.dirname);

  for (let port = first; port < first + TRIES; port++) {
    /* Adopted only when it is serving THIS workspace. One canvas per design,
     * not one canvas per machine: two agents working in two repositories both
     * start a studio, and a studio that answers for somebody else's workspace
     * would show each of them the other's screens — silently, since a canvas
     * full of screens looks exactly like a canvas full of the right screens.
     *
     * Sharing the one that IS ours is still right: it keeps a single writer,
     * which is the whole reason this is not simply a second server. */
    if (await ours(port, options.workspace.root)) {
      return { url: `http://${HOST}:${port}`, port, adopted: true, stop: () => undefined };
    }

    const server = start(port, options.workspace, bundleDir);
    if (server) {
      return {
        url: `http://${HOST}:${port}`,
        port,
        adopted: false,
        stop: () => server.stop(true),
      };
    }
  }

  throw new Error(`No free port between ${first} and ${first + TRIES - 1}.`);
}

interface Listener {
  stop(closeActive?: boolean): void;
}

function start(port: number, ws: Workspace, bundleDir: string | undefined): Listener | undefined {
  try {
    return Bun.serve({
      port,
      hostname: HOST,
      idleTimeout: 60,
      fetch: (req) => handle(req, ws, bundleDir, port),
    }) as unknown as Listener;
  } catch {
    // Taken by something that is not us.
    return undefined;
  }
}

/** A flowkit canvas that is currently running. */
export interface Instance {
  port: number;
  pid: number;
  workspace: string;
}

/** Every flowkit canvas answering on the ports the server would use. Walks the
 *  same range serveStudio does, from `from` (defaulting to the built-in start),
 *  so `flowkit ps` finds whatever the adoption logic would have adopted. */
export async function scanInstances(from: number = DEFAULT_PORT): Promise<Instance[]> {
  const found: Instance[] = [];
  for (let port = from; port < from + TRIES; port++) {
    try {
      const res = await fetch(`http://${HOST}:${port}/health`, {
        signal: AbortSignal.timeout(300),
      });
      if (!res.ok) continue;
      const health = (await res.json()) as { app?: string; pid?: number; workspace?: string };
      if (health.app === IDENT && typeof health.pid === 'number' && health.workspace) {
        found.push({ port, pid: health.pid, workspace: health.workspace });
      }
    } catch {
      // nothing there, or not answering — skip.
    }
  }
  return found;
}

async function ours(port: number, workspace: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${port}/health`, {
      signal: AbortSignal.timeout(400),
    });
    if (!res.ok) return false;
    const health = (await res.json()) as { app?: string; workspace?: string };
    if (health.app !== IDENT) return false;
    /* An older build answers without naming a workspace. Treat that as "not
     * ours": it is likelier to be another project's than this one's, and the
     * cost of being wrong the other way is showing somebody the wrong design. */
    return health.workspace !== undefined && resolve(health.workspace) === resolve(workspace);
  } catch {
    return false;
  }
}

async function handle(
  req: Request,
  ws: Workspace,
  bundleDir: string | undefined,
  port: number,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/health') {
    return json({ app: IDENT, pid: process.pid, port, workspace: ws.root });
  }

  /* A page on any website can ask a browser to POST to localhost, and this
   * endpoint writes to the user's files. Two cheap checks close that:
   *
   *   · the Host header must be a loopback name, which blunts DNS rebinding
   *     (an attacker's domain resolving to 127.0.0.1 arrives with THEIR name
   *     in Host, not ours);
   *   · a cross-site POST carries an Origin that is not ours.
   *
   * Neither is a substitute for the other, and both are one line. */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const refused = unsafeOrigin(req, port);
    if (refused) return json({ ok: false, error: refused }, 403);
  }
  if (!loopbackHost(req)) return json({ ok: false, error: 'Not a loopback host.' }, 403);

  if (path.startsWith('/projects/')) return project(req, ws, path);
  if (path.startsWith('/command/')) return command(req, ws, path);
  if (path.startsWith('/selection/')) return selection(req, ws, path);

  return asset(path, bundleDir);
}

/* ── the studio ─────────────────────────────────────────────────────────── */

/** The shell. Generated rather than shipped as a file: it is four lines, and
 *  one fewer artefact to keep in step with the bundle. */
const shell = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design Flow</title>
<link rel="stylesheet" href="/viewer.css">
</head>
<body>
<div id="root"></div>
<script src="/viewer.js"></script>
</body>
</html>
`;

async function asset(path: string, bundleDir: string | undefined): Promise<Response> {
  if (path === '/' || path === '/index.html') {
    return new Response(shell(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const name = path.replace(/^\//, '');
  // Only the two files the shell asks for. A general static server rooted at
  // a build directory is one path-traversal bug away from serving anything.
  if (name !== 'viewer.js' && name !== 'viewer.css') {
    return new Response('Not found', { status: 404 });
  }

  const file = bundleDir ? join(bundleDir, name) : undefined;
  if (!file || !(await exists(file))) {
    return new Response(
      'No viewer bundle. In the repo: `bun run build:viewer`. A published package ships ' +
        'it; if this is one, the install is incomplete. Or set FLOWKIT_VIEWER.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  return new Response(await readFile(file), {
    headers: {
      'Content-Type': name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript',
      // The bundle is rebuilt in place during development; a cached copy is
      // how you spend twenty minutes debugging a fix you already made.
      'Cache-Control': 'no-store',
    },
  });
}

/* ── the project ────────────────────────────────────────────────────────── */

async function project(req: Request, ws: Workspace, path: string): Promise<Response> {
  const id = idFrom(path, '/projects/').replace(/\.json$/, '');
  if (!id) return new Response('Not found', { status: 404 });

  let file: string;
  try {
    file = (await ws.require(id)).path;
  } catch (e) {
    return new Response(String(e instanceof Error ? e.message : e), {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const info = await stat(file).catch(() => undefined);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    // The studio polls this to notice an agent's change; without it the
    // canvas would never refresh.
    ...(info ? { 'Last-Modified': info.mtime.toUTCString() } : {}),
  };

  if (req.method === 'HEAD') return new Response(null, { headers });
  return new Response(await readFile(file), { headers });
}

/* ── writing ────────────────────────────────────────────────────────────── */

async function command(req: Request, ws: Workspace, path: string): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);

  const id = idFrom(path, '/command/');
  const body = await parse(req);
  if ('error' in body) return json({ ok: false, error: body.error }, 400);

  try {
    const { store } = await ws.require(id);
    // All-or-nothing, one entry in the log: dragging five screens is one
    // thing that happened, and undoes as one.
    // One command or a list of them: the canvas sends a single move and a
    // whole dragged selection through the same endpoint.
    const commands = (Array.isArray(body.value) ? body.value : [body.value]) as Command[];
    const result = await store.runAll(commands, 'ui');
    return json({ ok: result.ok, diagnostics: result.diagnostics }, result.ok ? 200 : 400);
  } catch (e) {
    return json({ ok: false, error: message(e) }, 404);
  }
}

async function selection(req: Request, ws: Workspace, path: string): Promise<Response> {
  const id = idFrom(path, '/selection/');

  /* How many gestures are waiting, for the header to show. Read-only, and the
   * canvas asks for it on the same beat it polls the document — a person who
   * has pointed at three things wants to see that the agent has three to
   * answer, and to see it go back to nothing once they have been read. */
  if (req.method === 'GET') {
    try {
      const { id: project } = await ws.require(id);
      return json({ ok: true, count: await countSelections(project) });
    } catch {
      // An id that is not open yet has nothing waiting. Not an error: the
      // canvas polls this before anything has been selected.
      return json({ ok: true, count: 0 });
    }
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'GET or POST only.' }, 405);

  const body = await parse(req);
  if ('error' in body) return json({ ok: false, error: body.error }, 400);

  const incoming = body.value as Omit<Selection, 'project' | 'at'>;
  if (!incoming?.region) return json({ ok: false, error: 'A selection needs a region.' }, 400);

  try {
    // Resolve the project so a selection cannot be recorded against an id
    // that does not exist.
    const { id: project } = await ws.require(id);
    const count = await saveSelection({
      ...incoming,
      nodes: incoming.nodes ?? [],
      elements: incoming.elements ?? [],
      project,
      at: new Date().toISOString(),
    });
    return json({ ok: true, count });
  } catch (e) {
    return json({ ok: false, error: message(e) }, 404);
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

const idFrom = (path: string, prefix: string): string =>
  decodeURIComponent(path.slice(prefix.length).split('/')[0] ?? '');

async function parse(req: Request): Promise<{ value: unknown } | { error: string }> {
  try {
    return { value: (await req.json()) as unknown };
  } catch (e) {
    return { error: `Not JSON: ${message(e)}` };
  }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Empty when the request may write. */
function unsafeOrigin(req: Request, port: number): string {
  const origin = req.headers.get('origin');
  // A same-origin fetch sends its own origin; a non-browser caller (the CLI,
  // a test) sends none at all. Anything else came from another site.
  if (origin === null) return '';
  const allowed = [`http://${HOST}:${port}`, `http://localhost:${port}`];
  return allowed.includes(origin) ? '' : `Refused a write from ${origin}.`;
}

function loopbackHost(req: Request): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0] ?? '';
  return host === HOST || host === 'localhost' || host === '[::1]' || host === '';
}
