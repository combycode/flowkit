/* Call the MCP server from the command line.
 *
 * Adding an MCP server to a Claude Code session needs a restart, which is a
 * miserable loop for developing one. This is the loop instead: it speaks the
 * real protocol over real stdio to the real server, so whatever it sees is
 * what a client would see — with none of the restarting.
 *
 *   bun run tools/mcp-call.ts                          list the tools
 *   bun run tools/mcp-call.ts overview
 *   bun run tools/mcp-call.ts list_items tier=screen
 *   bun run tools/mcp-call.ts get_item name=01-first-run
 *   bun run tools/mcp-call.ts render_screen screen=04-ready --save shot.png
 *
 * Arguments are key=value. Values parse as JSON when they can, so
 * `scale=2` is a number and `entries={"a.b":"c"}` is an object.
 */

import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { workspaceDir } from '../packages/host/src/paths';

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const WORKSPACE = flag('workspace') ?? workspaceDir();
const SAVE = flag('save');
/** Poll a background task to completion instead of returning its id. */
const WAIT = process.argv.includes('--wait');

const positional = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith('--')) return false;
  return !all[i - 1]?.startsWith('--');
});

const [tool, ...pairs] = positional;

const args: Record<string, unknown> = {};
for (const pair of pairs) {
  const at = pair.indexOf('=');
  if (at === -1) continue;
  const key = pair.slice(0, at);
  const raw = pair.slice(at + 1);
  try {
    args[key] = JSON.parse(raw);
  } catch {
    args[key] = raw; // a bare string is the common case
  }
}

const client = new Client({ name: 'mcp-call', version: '0' });
await client.connect(
  new StdioClientTransport({
    command: 'bun',
    args: [
      'run',
      join(import.meta.dir, '..', 'packages', 'mcp-server', 'src', 'main.ts'),
      '--workspace',
      WORKSPACE,
    ],
  }),
);

try {
  if (!tool) {
    const { tools } = await client.listTools();
    console.log(`${tools.length} tools in ${WORKSPACE}\n`);
    for (const t of tools) {
      const params = Object.keys(
        (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      console.log(`  ${t.name.padEnd(18)} ${params.join(', ') || '—'}`);
    }
  } else {
    // A full export renders hundreds of screens and runs for minutes, well
    // past the SDK's default request timeout. Progress notifications from the
    // server reset it; this raises the ceiling for clients that ignore them.
    const result = (await client.callTool({ name: tool, arguments: args }, undefined, {
      timeout: 20 * 60_000,
      resetTimeoutOnProgress: true,
    })) as {
      content: { type: string; text?: string; data?: string }[];
      isError?: boolean;
    };

    // A tool that starts a background task returns before the work is done.
    // In a real session the server stays up and the model polls; a one-shot
    // CLI would exit and kill it, so --wait polls the same way.
    const taskId = /\b(export_\w+-\d+)\b/.exec(
      result.content.map((c) => c.text ?? '').join(' '),
    )?.[1];

    if (WAIT && taskId) {
      let last = '';
      for (;;) {
        const status = (await client.callTool({
          name: 'task_status',
          // The project has to come too: every tool resolves one, and a poll
          // that omits it fails with "no project selected" on any machine
          // holding more than one.
          arguments: { task: taskId, ...(args.project ? { project: args.project } : {}) },
        })) as { content: { text?: string }[] };
        const line = status.content.map((c) => c.text ?? '').join('\n');
        if (!line.includes('running')) {
          console.log(line);
          break;
        }
        if (line !== last) {
          process.stdout.write(`\r${line.split('\n')[0]?.slice(0, 110).padEnd(110)}`);
          last = line;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      console.log('');
    }

    for (const part of result.content) {
      if (part.type === 'text' && !(WAIT && taskId)) console.log(part.text);
      else if (part.type === 'image') {
        const bytes = Buffer.from(part.data ?? '', 'base64');
        if (SAVE) {
          await Bun.write(SAVE, bytes);
          console.log(`[image ${(bytes.length / 1024).toFixed(0)} KB -> ${SAVE}]`);
        } else {
          console.log(
            `[image ${(bytes.length / 1024).toFixed(0)} KB — pass --save <file> to keep it]`,
          );
        }
      }
    }
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
