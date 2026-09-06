#!/usr/bin/env bun
/* `flowkit` — the command on somebody's PATH.
 *
 * Three kinds of thing:
 *   - BE the runtime: the MCP server + canvas (the default, how an agent starts
 *     it), the canvas alone (`serve`), or the tools alone (`mcp`).
 *   - WIRE a client up: write or print the config a given editor needs, because
 *     the alternative is a paragraph of JSON (or TOML) a person has to get
 *     exactly right before anything works.
 *   - MANAGE without an agent: list what is running, stop it, and do to projects
 *     what the MCP tools do — list, create, rename, move, remove, export — so a
 *     person or a script never has to open a conversation to tidy up.
 */

import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultPort, scanInstances, Workspace, workspaceDir } from '@flowkit/host';
import { emitConfig, writeConfig } from './cli/config';
import { HELP } from './cli/help';

const argv = process.argv.slice(2);
const [command, ...rest] = argv;

/** A `--name value` flag. */
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
/** A `--name` boolean flag. */
const has = (name: string): boolean => argv.includes(`--${name}`);

/** Flags that take a value, so their value is not mistaken for a positional. */
const VALUE_FLAGS = new Set(['workspace', 'port', 'dir', 'out', 'client']);

/** The positional arguments after the command. */
function positionals(): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a.slice(2))) i++; // skip its value
      continue;
    }
    out.push(a);
  }
  return out;
}

const workspace = (): Promise<Workspace> => Workspace.at(workspaceDir(flag('workspace')));

/** Print a table of `[cols]` rows with padded columns. */
function table(rows: string[][]): void {
  if (rows.length === 0) return;
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length))) ?? [];
  for (const r of rows) {
    console.log(r.map((cell, c) => (cell ?? '').padEnd(widths[c] ?? 0)).join('  '));
  }
}

/** The package version, from whichever package.json sits with the code: beside
 *  flowkit.js in the published bundle, or a level up from src/ in the source
 *  tree. (The published layout is `@combycode/flowkit/{flowkit.js,package.json}`
 *  — reading `..` there lands on the empty scope directory, which is the bug a
 *  bun-link test hid because `..` happened to reach the source manifest.) */
async function version(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const candidates = [
    resolve(import.meta.dirname, 'package.json'), // published: beside flowkit.js
    resolve(import.meta.dirname, '..', 'package.json'), // dev: src/ → package root
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(await readFile(p, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try the next location
    }
  }
  return 'unknown';
}

/** The one-shot verbs — everything that runs, prints, and exits. The
 *  long-running server commands are handled separately so they never exit. */
async function run(): Promise<number> {
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;

    case '--version':
    case '-v':
      console.log(await version());
      return 0;

    case 'init':
      // Wire up a repo for a client. Defaults to Claude Code's .mcp.json.
      return writeConfig({
        client: flag('client') ?? 'claude-code',
        dir: positionals()[0] ?? process.cwd(),
        designs: flag('dir'),
        npx: has('npx'),
      });

    case 'config': {
      const client = positionals()[0];
      if (!client) {
        console.error('Which client? e.g. flowkit config cursor. See flowkit help.');
        return 1;
      }
      return emitConfig({
        client,
        dir: process.cwd(),
        designs: flag('dir'),
        npx: has('npx'),
      });
    }

    case 'ps': {
      const running = await scanInstances(defaultPort(flag('port')));
      if (running.length === 0) {
        console.log('No flowkit canvas is running.');
        return 0;
      }
      table([
        ['PORT', 'PID', 'WORKSPACE'],
        ...running.map((i) => [String(i.port), String(i.pid), i.workspace]),
      ]);
      return 0;
    }

    case 'stop': {
      const running = await scanInstances(defaultPort(flag('port')));
      if (running.length === 0) {
        console.log('Nothing to stop.');
        return 0;
      }
      let targets: typeof running;
      if (has('all')) {
        targets = running;
      } else if (flag('port')) {
        targets = running.filter((i) => i.port === defaultPort(flag('port')));
      } else if (running.length === 1) {
        // One canvas up — even if it walked past the default port, it is the
        // obvious thing to stop.
        targets = running;
      } else {
        console.log('Several canvases are running — name one with --port, or stop all with --all:');
        table(running.map((i) => [String(i.port), i.workspace]));
        return 1;
      }
      if (targets.length === 0) {
        console.log('Nothing to stop.');
        return 0;
      }
      for (const t of targets) {
        try {
          process.kill(t.pid);
          console.log(`Stopped canvas on port ${t.port} (pid ${t.pid}).`);
        } catch (e) {
          console.error(`Could not stop pid ${t.pid}: ${e instanceof Error ? e.message : e}`);
        }
      }
      return 0;
    }

    case 'projects': {
      const ws = await workspace();
      const rows = await ws.list();
      if (rows.length === 0) {
        console.log('No projects. Make one with: flowkit new "My design"');
        return 0;
      }
      table([
        ['ID', 'NAME', 'SCREENS', 'PATH'],
        ...rows.map((p) => [p.id, `"${p.name}"`, String(p.screens), p.path]),
      ]);
      return 0;
    }

    case 'new': {
      const name = positionals()[0];
      if (!name) {
        console.error('A name is required: flowkit new "Checkout"');
        return 1;
      }
      const ws = await workspace();
      const meta = await ws.create(name, flag('dir'));
      console.log(`Created "${meta.name}" as ${meta.id}.\n  ${meta.path}`);
      return 0;
    }

    case 'rename': {
      const [id, ...words] = positionals();
      const name = words.join(' ');
      if (!id || !name) {
        console.error('Usage: flowkit rename <id> <new name>');
        return 1;
      }
      const ws = await workspace();
      const { store } = await ws.require(id);
      const r = await store.run({ t: 'project.rename', name });
      if (!r.ok) {
        console.error(`Rejected: ${r.diagnostics.map((d) => d.message).join('; ') || 'unknown'}`);
        return 1;
      }
      await ws.writeMeta(id);
      console.log(`Renamed ${id} to "${name}".`);
      return 0;
    }

    case 'move': {
      const [id, dest] = positionals();
      if (!id || !dest) {
        console.error('Usage: flowkit move <id> <destination-folder-or-file>');
        return 1;
      }
      const ws = await workspace();
      const meta = await ws.move(id, resolve(dest));
      console.log(`Moved ${id} to ${meta.path}.`);
      return 0;
    }

    case 'remove': {
      const id = positionals()[0];
      if (!id) {
        console.error('Usage: flowkit remove <id> [--delete]');
        return 1;
      }
      const ws = await workspace();
      const rows = await ws.list();
      const found = rows.find((p) => p.id === id);
      await ws.forgetProject(id);
      if (has('delete') && found) {
        await rm(found.path, { force: true });
        await rm(`${found.path.slice(0, -5)}.meta.json`, { force: true });
        console.log(`Removed ${id} and deleted its file.`);
      } else {
        console.log(
          `Forgot ${id} from the registry — its file is untouched. Pass --delete to remove it too.`,
        );
      }
      return 0;
    }

    case 'export':
      return exportProject();

    default:
      console.error(`Unknown command "${command}". Run: flowkit help`);
      return 1;
  }
}

/** `export` reuses the real export tools by speaking MCP to a throwaway server,
 *  so the CLI and an agent produce byte-identical output from one pipeline. */
async function exportProject(): Promise<number> {
  const id = positionals()[0];
  if (!id) {
    console.error('Usage: flowkit export <id> [--html|--viewer|--spec] [--out <dir>]');
    return 1;
  }
  const kind = has('html') ? 'html' : has('spec') ? 'spec' : 'viewer';
  const tool = { html: 'export_html', spec: 'export_spec', viewer: 'export_viewer' }[kind];

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'flowkit-cli', version: '0' });
  // Re-run THIS binary in mcp mode (no canvas) — `flowkit.js` in the published
  // package, `cli.ts` in the source tree. Spawning a fixed `main.ts` broke on a
  // real install, where only the bundle exists.
  const self = process.argv[1] ?? resolve(import.meta.dirname, 'flowkit.js');
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: [self, 'mcp', '--workspace', workspaceDir(flag('workspace'))],
    }),
  );
  try {
    const args: Record<string, unknown> = { project: id };
    if (flag('out')) args.out = resolve(flag('out') as string);
    if (kind === 'viewer') args.full = true;
    const r = (await client.callTool({ name: tool, arguments: args }, undefined, {
      timeout: 20 * 60_000,
      resetTimeoutOnProgress: true,
    })) as { content: { text?: string }[]; isError?: boolean };
    const text = r.content.map((c) => c.text ?? '').join('\n');
    // Exports run as a background task; poll it to completion for a one-shot CLI.
    const task = /\b(export_\w+-\d+)\b/.exec(text)?.[1];
    if (task) {
      const deadline = Date.now() + 20 * 60_000; // the same ceiling the tool has
      for (;;) {
        const s = (await client.callTool({
          name: 'task_status',
          arguments: { task, project: id },
        })) as { content: { text?: string }[] };
        const line = s.content.map((c) => c.text ?? '').join('\n');
        if (!line.includes('running')) {
          console.log(line);
          break;
        }
        if (Date.now() > deadline) {
          console.error('Export is still running after 20 minutes — giving up on waiting.');
          return 1;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      console.log(text);
    }
    return 0;
  } finally {
    await client.close().catch(() => undefined);
  }
}

// The long-running server commands must NOT exit — the process stays alive on
// the stdio transport (undefined / mcp) or the bound canvas port (serve).
// Everything else is a one-shot: run it, print a clean error on failure, exit.
if (command === undefined || command === 'mcp') {
  if (command === 'mcp' && !process.argv.includes('--no-studio')) process.argv.push('--no-studio');
  await import('./main.ts');
} else if (command === 'serve') {
  await import('@flowkit/host/server');
} else {
  try {
    process.exit(await run());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
