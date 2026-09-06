/* Export tools.
 *
 * Both exports go through the same `composeDocument` the canvas renders and
 * the sidecar photographs, so an exported file cannot differ from what was
 * approved. That is the whole reason composition lives in one function.
 *
 * They start a TASK and return its id rather than running to completion. A
 * full export is 248 screens and several minutes: holding the request open
 * blows the client's timeout and blocks the model on a job it does not need to
 * watch. Poll `task_status` instead.
 */

import { join } from 'node:path';
import {
  exportDir,
  exportHtml,
  exportPng,
  exportSpec,
  exportViewer,
  lightDocument,
  type Sidecar,
  type Workspace,
} from '@flowkit/host';
import { z } from 'zod';
import { type ToolReply, text } from '../reply';
import type { Tasks } from '../tasks';
import { describe } from '../tasks';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

export function registerExportTools(
  server: Registrar,
  ws: Workspace,
  sidecar: Sidecar,
  tasks: Tasks,
): void {
  register(server, ws, tools(sidecar, tasks));
}

interface CommonArgs {
  out?: string;
  screens?: string[];
  viewports?: string[];
  themes?: string[];
  locales?: string[];
  groups?: string[];
  generated?: 'only' | 'exclude';
}

const COMMON_SCHEMA = {
  out: z.string().optional().describe('Output folder. Defaults to the app export directory.'),
  screens: z.array(z.string()).optional().describe('Screen names. Defaults to every screen.'),
  viewports: z.array(z.string()).optional().describe('Defaults to every viewport.'),
  themes: z.array(z.string()).optional().describe('Defaults to every theme.'),
  locales: z.array(z.string()).optional().describe('Defaults to the default locale only.'),
  groups: z.array(z.string()).optional().describe('Only screens in these flows.'),
  generated: z
    .enum(['only', 'exclude'])
    .optional()
    .describe(
      'The kit sheets are screens too, so they export with everything by default. ' +
        '"exclude" leaves them out; "only" hands over the design system and nothing else.',
    ),
};

const selection = (args: CommonArgs) => ({
  ...(args.screens ? { screens: args.screens } : {}),
  ...(args.viewports ? { viewports: args.viewports } : {}),
  ...(args.themes ? { themes: args.themes } : {}),
  ...(args.locales ? { locales: args.locales } : {}),
  ...(args.groups ? { groups: args.groups } : {}),
  ...(args.generated ? { generated: args.generated } : {}),
});

const started = (id: string, what: string): ToolReply =>
  text(`Started ${id} — ${what}.\nIt runs in the background; poll task_status to see how it ends.`);

function tools(sidecar: Sidecar, tasks: Tasks): ToolSpec[] {
  return [
    {
      name: 'export_html',
      config: {
        title: 'Export screens as HTML',
        description:
          'Writes one page per screen plus an index that frames them all — grouped by flow, ' +
          'with switches for size, theme and language, and each screen listing what it ' +
          'connects to. Open index.html; no server needed. Runs as a background task.',
        inputSchema: { ...COMMON_SCHEMA, inline: z.boolean().optional() },
      },
      run: async (
        args: CommonArgs & { inline?: boolean },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const outDir = args.out ?? join(exportDir(ctx.path), 'html');
        const doc = ctx.store.get();
        const task = tasks.start('export_html', ctx.id, async (handle) => {
          const result = await exportHtml(doc, {
            outDir,
            onFile: (name, done, total) => handle.progress(done, total, name),
            ...(args.inline !== undefined ? { inline: args.inline } : {}),
            ...selection(args),
          });
          return [
            `${result.files.length} pages from ${ctx.id}`,
            `index:  ${result.indexPath}`,
            `size:   ${(result.bytes / 1024 / 1024).toFixed(1)} MB`,
          ].join('\n');
        });
        return started(task.id, `HTML export of ${ctx.id} to ${outDir}`);
      },
    },

    {
      name: 'export_spec',
      config: {
        title: 'Write the design out as a specification',
        description:
          'A markdown document somebody can build from, with the screens as pictures beside ' +
          'it: what each screen is for, what is written on it, what it is assembled from, and ' +
          'what leads in and out of it on what condition. Ends with the design system — the ' +
          'parts to build first — and with a section naming what the design does NOT answer: ' +
          'dead ends, screens nothing leads to, and connections the importer guessed rather ' +
          'than anybody decided. ' +
          'This is the handover artefact. export_viewer shows the design; this one says what ' +
          'to do about it, and drops into a ticket or a contract as text. ' +
          'The copy is quoted from the strings rather than retyped, so what is in the spec is ' +
          'what will ship. Pictures at ONE viewport — name it, or run it twice. ' +
          'noImages=true for text alone.',
        inputSchema: {
          project: z.string().optional(),
          out: z.string().optional(),
          viewport: z.string().optional(),
          theme: z.string().optional(),
          locale: z.string().optional(),
          scale: z.number().optional(),
          noImages: z.boolean().optional(),
          screens: z.array(z.string()).optional(),
          groups: z.array(z.string()).optional(),
          generated: z.enum(['only', 'exclude']).optional(),
        },
      },
      run: async (
        args: {
          project?: string;
          out?: string;
          viewport?: string;
          theme?: string;
          locale?: string;
          scale?: number;
          noImages?: boolean;
          screens?: string[];
          groups?: string[];
          generated?: 'only' | 'exclude';
        },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const outDir = args.out ?? join(exportDir(ctx.path), 'spec');
        const task = tasks.start('export_spec', ctx.id, async (handle) => {
          const result = await exportSpec(doc, sidecar, {
            outDir,
            ...(args.viewport !== undefined ? { viewport: args.viewport } : {}),
            ...(args.theme !== undefined ? { theme: args.theme } : {}),
            ...(args.locale !== undefined ? { locale: args.locale } : {}),
            ...(args.scale !== undefined ? { scale: args.scale } : {}),
            ...(args.noImages !== undefined ? { noImages: args.noImages } : {}),
            ...selection(args),
            onScreen: (name, done, total) => handle.progress(done, total, name),
          });
          return [
            `${result.screens} screens from ${ctx.id}`,
            `spec:   ${result.path}`,
            `images: ${result.images}`,
            `size:   ${(result.bytes / 1024 / 1024).toFixed(1)} MB`,
          ].join('\n');
        });
        return started(task.id, `specification of ${ctx.id} to ${outDir}`);
      },
    },

    {
      name: 'export_viewer',
      config: {
        title: 'Export the whole design as one shareable file',
        description:
          'One HTML file containing the canvas itself: every screen where it sits, the ' +
          'connections between them and their labels, plus the flow filter. It opens by ' +
          'double-clicking — no server, no account, no network — so it can be attached to a ' +
          'pull request or emailed. Read-only, and a SNAPSHOT: what you send stays what you ' +
          'sent. ' +
          'Prefer this over export_html when someone needs to understand the FLOW; the folder ' +
          'export gives pages and says nothing about how anyone gets between them. ' +
          'BY DEFAULT THE SCREENS ARE PICTURES, and the markup, the CSS, the copy and the ' +
          'fonts stay behind — a client or a review board sees the design without receiving ' +
          'the implementation. Because a screen carries one picture, this exports at ONE ' +
          'viewport; name it, or export twice. ' +
          'Pass full=true for the live document instead: every screen rendered from its real ' +
          'markup, with the theme, language and size switches working. Send that to somebody ' +
          'who is going to build it.',
        inputSchema: {
          project: z.string().optional(),
          out: z.string().optional(),
          full: z
            .boolean()
            .optional()
            .describe('Ship the real document — markup, CSS and copy included.'),
          viewport: z.string().optional(),
          theme: z.string().optional(),
          locale: z.string().optional(),
          scale: z.number().optional(),
          screens: z.array(z.string()).optional(),
          groups: z.array(z.string()).optional(),
          generated: z.enum(['only', 'exclude']).optional(),
        },
      },
      run: async (
        args: {
          project?: string;
          out?: string;
          full?: boolean;
          viewport?: string;
          theme?: string;
          locale?: string;
          scale?: number;
          screens?: string[];
          groups?: string[];
          generated?: 'only' | 'exclude';
        },
        ctx: ToolContext,
      ): Promise<ToolReply> => {
        const doc = ctx.store.get();
        const out = args.out ?? join(exportDir(ctx.path), `${ctx.id}.html`);
        const task = tasks.start('export_viewer', ctx.id, async (handle) => {
          const shipped = args.full
            ? { doc, note: 'the live document' }
            : await lightDocument(doc, sidecar, {
                ...(args.viewport !== undefined ? { viewport: args.viewport } : {}),
                ...(args.theme !== undefined ? { theme: args.theme } : {}),
                ...(args.locale !== undefined ? { locale: args.locale } : {}),
                ...(args.scale !== undefined ? { scale: args.scale } : {}),
                ...(args.screens ? { screens: args.screens } : {}),
                ...(args.groups ? { groups: args.groups } : {}),
                ...(args.generated ? { generated: args.generated } : {}),
                onScreen: (name, done, total) => handle.progress(done, total, name),
              }).then((light) => ({
                doc: light.doc,
                note: `pictures at ${light.doc.viewports[0]?.id ?? 'one size'} — no markup, no copy`,
              }));

          const result = await exportViewer({ doc: shipped.doc, out });
          return [
            `${result.screens} screens, ${result.edges} connections from ${ctx.id}`,
            `shows:  ${shipped.note}`,
            `file:   ${result.path}`,
            `size:   ${(result.bytes / 1024 / 1024).toFixed(1)} MB`,
            'Opens on its own. Send it to anyone.',
          ].join('\n');
        });
        return started(task.id, `shareable file for ${ctx.id} at ${out}`);
      },
    },

    {
      name: 'export_png',
      config: {
        title: 'Export screens as images',
        description:
          'Renders each screen to a PNG named like `04-ready@mobile-dark.png`. 2x by ' +
          'default, because these are for people to look at. Runs as a background task — ' +
          'a full set takes minutes.',
        inputSchema: { ...COMMON_SCHEMA, scale: z.number().optional() },
      },
      run: async (args: CommonArgs & { scale?: number }, ctx: ToolContext): Promise<ToolReply> => {
        const outDir = args.out ?? join(exportDir(ctx.path), 'png');
        const doc = ctx.store.get();
        const task = tasks.start('export_png', ctx.id, async (handle) => {
          const result = await exportPng(doc, sidecar, {
            outDir,
            onFile: (name, done, total) => handle.progress(done, total, name),
            ...(args.scale !== undefined ? { scale: args.scale } : {}),
            ...selection(args),
          });
          return [
            `${result.files.length} images from ${ctx.id}`,
            `folder: ${outDir}`,
            `size:   ${(result.bytes / 1024 / 1024).toFixed(1)} MB in ${(result.ms / 1000).toFixed(1)}s`,
          ].join('\n');
        });
        return started(task.id, `PNG export of ${ctx.id} to ${outDir}`);
      },
    },

    {
      name: 'task_status',
      config: {
        title: 'Check a background task',
        description: 'How an export is going, or how it ended. Without an id, lists recent tasks.',
        inputSchema: { task: z.string().optional() },
      },
      run: (args: { task?: string }): ToolReply => {
        if (args.task) {
          const task = tasks.get(args.task);
          if (!task) {
            const known = tasks.list().map((t) => t.id);
            return text(
              `No task "${args.task}".${known.length > 0 ? ` Known: ${known.join(', ')}.` : ' None have run.'}`,
            );
          }
          return text(describe(task));
        }
        const all = tasks.list();
        return text(all.length === 0 ? 'No tasks yet.' : all.map(describe).join('\n\n'));
      },
    },
  ];
}
