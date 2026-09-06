/* Getting back to a version that was right.
 *
 * Undo covers the mistake noticed now. These cover the one noticed tomorrow:
 * a command that was valid, accepted, and simply wrong, after the log has
 * rolled past it.
 *
 * `restore_project` is the one destructive tool in the server, so it behaves
 * like one — it copies what it is about to replace before replacing it, and
 * it says what changed rather than reporting success.
 */

import type { ProjectDoc } from '@flowkit/core';
import { backups, findBackup, readJson, type Workspace } from '@flowkit/host';
import { z } from 'zod';
import { failure, type ToolReply, text } from '../reply';
import { type Registrar, register, type ToolContext, type ToolSpec } from './registrar';

export function registerRecoverTools(server: Registrar, ws: Workspace): void {
  register(server, ws, tools());
}

function tools(): ToolSpec[] {
  return [
    {
      name: 'list_backups',
      config: {
        title: 'Earlier versions of the project',
        description:
          'Copies taken before changes, newest first. One is kept before the first change of ' +
          'each session and every few minutes after, so there is a way back from an edit that ' +
          'was accepted and wrong. Undo handles what just happened; these handle yesterday.',
        inputSchema: {},
      },
      run: async (_args: never, ctx: ToolContext): Promise<ToolReply> => {
        const found = await backups(ctx.path);
        if (found.length === 0) {
          return text(`No earlier versions of ${ctx.id} yet — nothing has changed it.`);
        }

        return text(
          [
            `${found.length} earlier version${found.length === 1 ? '' : 's'} of ${ctx.id}:`,
            ...found.map((b) => `  ${b.at}   ${(b.bytes / 1024).toFixed(0)} KB`),
            '',
            'restore_project at=<timestamp> puts one back. The current version is copied first.',
          ].join('\n'),
        );
      },
    },

    {
      name: 'restore_project',
      config: {
        title: 'Put an earlier version back',
        description:
          'Replaces the whole document with an earlier copy. The version being replaced is ' +
          'copied first, so this is reversible by restoring that one. ' +
          'It also clears the undo history, because every step in it was computed against a ' +
          'document that is no longer there. Omit `at` for the most recent copy.',
        inputSchema: { at: z.string().optional() },
      },
      writes: true,
      run: async (args: { at?: string }, ctx: ToolContext): Promise<ToolReply> => {
        const found = await findBackup(ctx.path, args.at);
        if (!found) {
          const all = await backups(ctx.path);
          return failure(
            all.length === 0
              ? `No earlier versions of ${ctx.id} to restore.`
              : `No version at "${args.at}". Available: ${all.map((b) => b.at).join(', ')}.`,
          );
        }

        const before = ctx.store.get();
        const restored = await readJson<ProjectDoc>(found.path);
        await ctx.store.restore(restored);

        return text(
          [
            `Restored ${ctx.id} to the version from ${found.at}.`,
            summary('was', before),
            summary('now', restored),
            'The replaced version was copied first — list_backups to see it.',
            'Undo history cleared: its steps belonged to the document that was replaced.',
          ].join('\n'),
        );
      },
    },
  ];
}

const summary = (label: string, doc: ProjectDoc): string =>
  `  ${label}:  ${Object.keys(doc.items).length} items, ` +
  `${Object.keys(doc.flow.nodes).length} screens on the canvas, ` +
  `${Object.keys(doc.flow.edges).length} connections, updated ${doc.updatedAt}`;
