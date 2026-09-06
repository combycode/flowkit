/* Registration, and the one place project resolution happens.
 *
 * Every tool takes an optional `project`. Rather than repeat that argument
 * and its lookup in twenty definitions, it is injected here: the schema gains
 * the field, the handler resolves it, and each tool receives an already-chosen
 * store. A tool cannot forget to honour it, and cannot resolve it differently
 * from its neighbours.
 *
 * Writers also get their listing cache refreshed here, for the same reason.
 */

import { TAILWIND_SHEET, tailwindBuild, tailwindHeader, tailwindStale } from '@flowkit/core';
import { compileTailwind, type Store, type Workspace } from '@flowkit/host';
import { z } from 'zod';

/** Reporting how far a long job has got.
 *
 *  A full export renders hundreds of screens and runs for minutes — far past
 *  a client's default request timeout. Progress notifications reset that
 *  timer, so this is not decoration: without it a large export is killed
 *  mid-way and the caller sees a timeout rather than a folder of files. */
export type Progress = (done: number, total: number, note?: string) => void;

/** What a tool is handed once the project is settled. */
export interface ToolContext {
  id: string;
  store: Store;
  /** The project file. Exports default to a folder beside it. */
  path: string;
  progress: Progress;
}

/** Behaviour hints a client reads to decide whether a call needs confirming:
 *  a read may be auto-approved, a write is confirmed. flowkit's writes are all
 *  reversible (validated, and undone by `undo`), so none are marked destructive.
 *  See modelcontextprotocol.io on tool annotations. */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  /** Set on tools that change the document, so the listing cache is refreshed. */
  writes?: boolean;
  /** For tools registered WITHOUT the write machinery (the project tools): true
   *  marks one that only reads, so it can be annotated read-only. */
  readOnly?: boolean;
  run: (args: never, ctx: ToolContext) => unknown;
}

/** A tool's annotations: a reader is read-only; a writer is a non-destructive
 *  write (reversible via undo). `isRead` is decided by the caller, because the
 *  two registration paths classify differently — through `register` a tool is a
 *  reader unless it `writes`, while a bare project tool is a writer unless it
 *  explicitly says `readOnly`. */
function annotate(spec: ToolSpec, isRead: boolean): ToolAnnotations {
  return isRead
    ? { title: spec.config.title, readOnlyHint: true }
    : { title: spec.config.title, readOnlyHint: false, destructiveHint: false };
}

/** The slice of the MCP handler's second argument we use. */
export interface HandlerExtra {
  sendNotification?: (notification: unknown) => Promise<void> | void;
  _meta?: { progressToken?: string | number };
}

export interface Registrar {
  registerTool(
    name: string,
    config: ToolSpec['config'] & { annotations?: ToolAnnotations },
    handler: (args: never, extra: HandlerExtra) => unknown,
  ): unknown;
  /** Tell the client the resource list may have changed, so the `@` menu
   *  refetches. Present on McpServer; optional here so tests can pass a stub. */
  sendResourceListChanged?(): void;
}

/** Fire the resource-list-changed notification, swallowing the case where the
 *  server is not connected yet or has no resources — a write must never fail
 *  because a menu could not be refreshed. */
function announce(server: Registrar): void {
  try {
    void Promise.resolve(server.sendResourceListChanged?.()).catch(() => undefined);
  } catch {
    // not connected, or no resources registered — nothing to refresh
  }
}

/** A reporter bound to one request. Silent when the caller did not ask for
 *  progress, and never able to fail the job it is reporting on. */
function reporter(extra: HandlerExtra | undefined): Progress {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || !send) return () => undefined;
  return (done, total, note) => {
    void Promise.resolve(
      send({
        method: 'notifications/progress',
        params: { progressToken: token, progress: done, total, ...(note ? { message: note } : {}) },
      }),
    ).catch(() => undefined);
  };
}

/** Every writing tool, by name — so `batch` can dispatch to one without the
 *  registration wrapper. Populated as each family registers; complete by the
 *  time any tool is actually called. The value is the RAW spec, whose `run`
 *  takes (args, ctx) directly. */
export const writeToolSpecs = new Map<string, ToolSpec>();

export function register(server: Registrar, ws: Workspace, specs: readonly ToolSpec[]): void {
  for (const spec of specs) {
    if (spec.writes) writeToolSpecs.set(spec.name, spec);
    const config = {
      ...spec.config,
      inputSchema: {
        ...spec.config.inputSchema,
        project: z
          .string()
          .optional()
          .describe('Project id. Defaults to the one open_project selected.'),
      },
      // Read unless it writes — so a client can auto-approve reads and confirm
      // only writes (which are non-destructive: undo reverses them).
      annotations: annotate(spec, !spec.writes),
    };

    server.registerTool(spec.name, config, (async (
      args: { project?: string },
      extra: HandlerExtra,
    ) => {
      const { id, store, path } = await ws.require(args?.project);
      const reply = await spec.run(args as never, { id, store, path, progress: reporter(extra) });
      if (spec.writes) {
        await ws.writeMeta(id);
        await rebuildTailwind(store);
        // A write may have added, renamed or removed a screen or part, so the
        // `@` menu's resource list could be stale — tell the client to refetch.
        announce(server);
      }
      return reply;
    }) as (args: never, extra: HandlerExtra) => unknown);
  }
}

/** Recompile the utilities when the markup they were built from has moved.
 *
 *  Here rather than in each tool that writes markup, because every one of them
 *  can change a class name and none of them should have to remember. The check
 *  is a scan and a hash — the compiler only starts when the set of class names
 *  actually differs, so the ordinary write pays almost nothing.
 *
 *  A failure is swallowed on purpose: the write it follows has already been
 *  accepted, and a stylesheet that is one build behind is a smaller problem
 *  than an edit that reports failure after succeeding. `build_tailwind` says
 *  what went wrong when it is asked directly.
 */
async function rebuildTailwind(store: Store): Promise<void> {
  try {
    if (!tailwindStale(store.get())) return;

    const { input, candidates, stamp } = tailwindBuild(store.get());
    const css = tailwindHeader(stamp) + (await compileTailwind(input, candidates));
    await store.run({ t: 'sheet.set', name: TAILWIND_SHEET, css });
  } catch {
    // Said out loud by build_tailwind, not by the write that happened to be first.
  }
}

/** Project tools resolve nothing — they are how a project gets chosen in the
 *  first place, so they register without the injected argument. */
export function registerBare(server: Registrar, specs: readonly ToolSpec[]): void {
  for (const spec of specs) {
    // A project tool is a writer unless it says readOnly (list_projects,
    // open_project, open_canvas do not touch the document).
    const config = { ...spec.config, annotations: annotate(spec, spec.readOnly === true) };
    server.registerTool(spec.name, config, (async (args: never, extra: HandlerExtra) => {
      const reply = await spec.run(args, { progress: reporter(extra) } as unknown as ToolContext);
      // These are the project tools: opening, creating or moving a project
      // changes which screens `@` should list. A read like list_projects fires
      // it too, harmlessly — one refetch costs nothing.
      announce(server);
      return reply;
    }) as (args: never, extra: HandlerExtra) => unknown);
  }
}
