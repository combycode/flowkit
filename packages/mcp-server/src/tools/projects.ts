/* Project tools: list, create, open.
 *
 * `open_project` sets the active project so a run of calls against one
 * project costs no extra argument. Every other tool still accepts an explicit
 * `project`, which always wins — so switching for one call never disturbs
 * what the rest of the session is working on.
 */

import type { KitId } from '@flowkit/core';
import { openInBrowser, type Studio, type Workspace } from '@flowkit/host';
import { z } from 'zod';
import { failure, type ToolReply, text } from '../reply';
import { type Registrar, registerBare, type ToolSpec } from './registrar';

/** The canvas, when there is one. A FUNCTION rather than a value: tools are
 *  registered before the studio is started, and a studio that failed to start
 *  is a normal state — the tools work without it. */
export type Canvas = () => Studio | undefined;

export function registerProjectTools(server: Registrar, ws: Workspace, canvas: Canvas): void {
  registerBare(server, tools(ws, canvas));
}

/** Where to look at a project.
 *
 *  Reported with every project a tool hands back, because the port is not
 *  always 5190 — a studio for another design may already hold it — and a
 *  person told "created" with no address has to go and find out. That is
 *  exactly what happened the first time somebody used this: the project was
 *  made, the canvas was on 5191, and the URL they tried was a different
 *  workspace's studio answering "could not load". */
function canvasLine(canvas: Canvas, id: string): string[] {
  const studio = canvas();
  if (!studio) return [];
  return ['', `Canvas: ${studio.url}/?project=${encodeURIComponent(id)}`];
}

function tools(ws: Workspace, canvas: Canvas): ToolSpec[] {
  return [
    {
      name: 'list_projects',
      config: {
        title: 'List projects',
        description:
          'Every project this session can reach — the default folder plus any opened from ' +
          'elsewhere, such as inside a repo. Shows where each one lives.',
        inputSchema: {},
      },
      run: async (): Promise<ToolReply> => {
        const rows = await ws.list();
        if (rows.length === 0) {
          return text(
            'No projects yet. create_project makes one — pass `dir` to put it in a repo, ' +
              'or open_project with a path to adopt an existing file.',
          );
        }
        const active = ws.activeId();
        return text(
          rows
            .map(
              (p) =>
                `${p.id === active ? '* ' : '  '}${p.id}  "${p.name}"  ` +
                `${p.screens} screens, ${p.nodes} nodes\n     ${p.path}`,
            )
            .concat(active ? ['', '* = active'] : ['', 'None selected.'])
            .join('\n'),
        );
      },
    },

    {
      name: 'open_project',
      config: {
        title: 'Select a project',
        description:
          'Takes an id, or a path to a project file anywhere on disk — ' +
          'open_project ./design/app.json works. Makes it the default for later calls.',
        inputSchema: { project: z.string() },
      },
      run: async ({ project }: { project: string }): Promise<ToolReply> => {
        const meta = await ws.select(project);
        return text(
          [
            `Active project: ${meta.id} "${meta.name}" — ${meta.screens} screens, ` +
              `${meta.nodes} nodes.`,
            meta.path,
            ...canvasLine(canvas, meta.id),
          ].join('\n'),
        );
      },
    },

    {
      name: 'create_project',
      config: {
        title: 'Create a project',
        description:
          'Starts a project and makes it active. It comes with a small design system — ' +
          'tokens for colour, type, spacing and radii in a dark and a light theme, a reset, ' +
          'a house style, and four connected screens that use all of it. Read those screens ' +
          'before writing new ones and follow what they do; extending a worked example keeps ' +
          'a project consistent in a way that inventing conventions per screen does not. ' +
          'Pass kit="blank" for tokens only, when bringing an existing design system. ' +
          'Pass `dir` to put the file inside a repo, next to the code it describes; without ' +
          'it the project goes in the default folder. The id comes from the name.',
        inputSchema: {
          name: z.string(),
          dir: z
            .string()
            .optional()
            .describe('Folder to create it in. Use it to put the design inside a repo.'),
          kit: z
            .enum(['starter', 'blank'])
            .optional()
            .describe('starter (default) brings a design system and four screens; blank does not.'),
        },
      },
      run: async ({
        name,
        dir,
        kit,
      }: {
        name: string;
        dir?: string;
        kit?: KitId;
      }): Promise<ToolReply> => {
        const meta = await ws.create(name, dir, kit ?? 'starter');
        return text(
          [
            `Created "${meta.name}" as ${meta.id}, and made it active.`,
            meta.path,
            ...canvasLine(canvas, meta.id),
            '',
            meta.screens > 0
              ? `It starts with ${meta.screens} screens and a small design system. ` +
                'READ ONE WITH get_item BEFORE WRITING ANOTHER: follow its classes, its ' +
                'tokens and its data-t keys rather than inventing new ones, or the second ' +
                'screen will not match the first.'
              : 'Tokens only, no screens. create_item with tier "screen", then add_node to ' +
                'put it on the canvas.',
          ].join('\n'),
        );
      },
    },

    {
      name: 'move_project',
      config: {
        title: 'Move the project file somewhere else',
        description:
          'Relocate the design to another folder or path, keeping its id and content — the ' +
          'right way to answer "store this in the repo" or "move it out of the default ' +
          'folder". Opening the file by hand at a new place instead makes a duplicate entry ' +
          'and leaves a dead one; this does not. ' +
          '`to` is a folder (the file keeps its name) or a full .json path. The undo history ' +
          'does not follow the move — it stays with the old location.',
        inputSchema: {
          to: z.string().describe('Destination folder, or a full path ending in .json.'),
          project: z.string().optional().describe('Defaults to the active project.'),
        },
      },
      writes: true,
      run: async ({ to, project }: { to: string; project?: string }): Promise<ToolReply> => {
        const id = project ?? ws.activeId();
        if (!id) {
          return failure('No project selected. Pass project=<id>, or open_project first.');
        }
        try {
          const meta = await ws.move(id, to);
          return text(
            [`Moved "${meta.id}" to:`, meta.path, ...canvasLine(canvas, meta.id)].join('\n'),
          );
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
    },

    {
      name: 'forget_project',
      config: {
        title: 'Remove a project from the list',
        description:
          'Drops a remembered project from the list without touching its file — for a dead ' +
          'entry pointing at a path that no longer exists, or one you no longer want shown. ' +
          'To delete the design itself, remove its .json file; this only forgets where it was.',
        inputSchema: { project: z.string().describe('The id to forget.') },
      },
      writes: true,
      run: async ({ project }: { project: string }): Promise<ToolReply> => {
        const rows = await ws.list();
        if (!rows.some((p) => p.id === project)) {
          return failure(
            `No project "${project}" is listed. Current: ${rows.map((p) => p.id).join(', ') || 'none'}.`,
          );
        }
        await ws.forgetProject(project);
        return text(`Forgot "${project}". Its file, if any, is untouched.`);
      },
    },

    {
      name: 'open_canvas',
      config: {
        title: 'Open the canvas in a browser',
        description:
          "Opens the design in the person's own browser. ONLY when they ask — a window " +
          "appearing on somebody's screen unbidden is startling, and every reply that " +
          'names a project already carries the address. "Create it and open it" is a ' +
          'request; "create it" is not.',
        inputSchema: {
          project: z.string().optional().describe('Defaults to the active project.'),
        },
      },
      run: async ({ project }: { project?: string }): Promise<ToolReply> => {
        const studio = canvas();
        if (!studio) {
          return failure(
            'The canvas is not running, so there is nothing to open. It normally starts with ' +
              'this server; if it did not, the port may be held by something else — ' +
              '`flowkit serve` reports what happened.',
          );
        }

        const id = project ?? ws.activeId();
        if (!id) {
          return failure(
            'No project selected. Pass project=<id>, or open_project first. ' +
              'list_projects shows what there is.',
          );
        }

        const url = `${studio.url}/?project=${encodeURIComponent(id)}`;
        try {
          await openInBrowser(url);
          return text(`Opened ${url}`);
        } catch (error) {
          /* Not a failure worth stopping for: a machine with no desktop, or a
             browser that refused to start, still leaves a usable address. */
          return text(
            `Could not open a browser (${error instanceof Error ? error.message : String(error)}).` +
              `\nThe canvas is at ${url}`,
          );
        }
      },
    },
  ];
}
