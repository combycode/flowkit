/* Per-client MCP configuration.
 *
 * Every editor reads MCP servers from its own file in its own shape. Three
 * shapes cover them all: the `mcpServers` JSON object most of them share, the
 * TOML table Codex uses, and opencode's `mcp` block with a command ARRAY. This
 * knows where each client's file lives — in the repo, or in the user's home —
 * and writes it, merging so a file that already lists other servers keeps them.
 *
 * `flowkit init --client X` writes the file for the client named; `flowkit
 * config X` only prints it, for someone who would rather paste it themselves.
 *
 * The invocation is a global install by default — `command: "flowkit"` — with a
 * `--npx` variant that runs `bunx @combycode/flowkit` for people who would rather not
 * install anything.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { exists } from '@flowkit/host';

type Format = 'mcpServers' | 'toml' | 'opencode';

interface Client {
  /** Where the file is, given the repo root and the user's home directory.
   *  ('home' clients ignore root; 'repo' clients ignore home.) */
  where(root: string, home: string): string;
  format: Format;
  /** True when the file lives in the user's home rather than the repo. A repo
   *  client's folder is EXPECTED to be missing in a fresh checkout, so only a
   *  home client's missing folder is worth remarking on. */
  home?: boolean;
  /** A one-line reminder of anything client-specific. */
  note?: string;
}

function claudeDesktop(home: string): string {
  const dir =
    platform() === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude')
      : platform() === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Claude')
        : join(home, '.config', 'Claude');
  return join(dir, 'claude_desktop_config.json');
}

const CLIENTS: Record<string, Client> = {
  'claude-code': {
    format: 'mcpServers',
    where: (root) => join(root, '.mcp.json'),
    note: 'Start Claude Code in this directory; it reads .mcp.json from the repo root.',
  },
  cursor: {
    format: 'mcpServers',
    where: (root) => join(root, '.cursor', 'mcp.json'),
    note: 'Project scope. A global equivalent lives at ~/.cursor/mcp.json.',
  },
  antigravity: {
    format: 'mcpServers',
    where: (root) => join(root, '.agents', 'mcp_config.json'),
    note: 'CLI and IDE share this. The global file is ~/.gemini/config/mcp_config.json.',
  },
  opencode: {
    format: 'opencode',
    where: (root) => join(root, 'opencode.json'),
    note: 'Global equivalent: ~/.config/opencode/opencode.json.',
  },
  'claude-desktop': {
    format: 'mcpServers',
    home: true,
    where: (_root, home) => claudeDesktop(home),
    note: 'A global file — restart Claude Desktop after writing it.',
  },
  codex: {
    format: 'toml',
    home: true,
    where: (_root, home) => join(home, '.codex', 'config.toml'),
    note: 'Codex CLI and IDE share this global file.',
  },
  windsurf: {
    format: 'mcpServers',
    home: true,
    where: (_root, home) => join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    note: 'A global file — restart Windsurf after writing it.',
  },
};

export const CLIENT_NAMES = Object.keys(CLIENTS);

interface Opts {
  client: string;
  /** The repo root (for repo-scoped files and the default designs folder). */
  dir: string;
  /** Where the designs live. Defaults to <repo>/design. */
  designs?: string | undefined;
  npx: boolean;
  /** Home directory, overridable for tests. Defaults to the real one. */
  home?: string | undefined;
}

const homeOf = (o: Opts): string => o.home ?? homedir();
const designsOf = (o: Opts): string => resolve(o.designs ?? join(o.dir, 'design'));

/** The command + args a config invokes flowkit with. */
function invocation(designs: string, npx: boolean): { command: string; args: string[] } {
  return npx
    ? { command: 'bunx', args: ['@combycode/flowkit', '--workspace', designs] }
    : { command: 'flowkit', args: ['--workspace', designs] };
}

/** The `[mcp_servers.flowkit]` table on its own. */
function tomlBlock(designs: string, npx: boolean): string {
  const { command, args } = invocation(designs, npx);
  const argList = args.map((a) => JSON.stringify(a)).join(', ');
  return `[mcp_servers.flowkit]\ncommand = ${JSON.stringify(command)}\nargs = [${argList}]\n`;
}

/** The flowkit entry alone, for a JSON file that may hold other servers. */
function entry(format: Format, designs: string, npx: boolean): Record<string, unknown> {
  const { command, args } = invocation(designs, npx);
  if (format === 'opencode') return { type: 'local', command: [command, ...args], enabled: true };
  return { command, args };
}

/** The whole config document as text, in the client's shape — for printing. */
function render(format: Format, designs: string, npx: boolean): string {
  if (format === 'toml') return tomlBlock(designs, npx);
  const key = format === 'opencode' ? 'mcp' : 'mcpServers';
  return `${JSON.stringify({ [key]: { flowkit: entry(format, designs, npx) } }, null, 2)}\n`;
}

function resolveClient(name: string): Client | undefined {
  return CLIENTS[name];
}

/** Print the snippet and where it goes — never touches a file. */
export function emitConfig(o: Opts): number {
  const client = resolveClient(o.client);
  if (!client) {
    console.error(`Unknown client "${o.client}". Known: ${CLIENT_NAMES.join(', ')}.`);
    return 1;
  }
  const designs = designsOf(o);
  console.log(`Add this to ${client.where(resolve(o.dir), homeOf(o))}:\n`);
  console.log(render(client.format, designs, o.npx));
  if (client.note) console.log(client.note);
  console.log(`\n  designs: ${designs}`);
  return 0;
}

/** Merge the flowkit table into existing TOML, replacing an earlier one in
 *  place and otherwise appending — so other servers and any comments survive,
 *  which a parse-and-rewrite would not promise. */
function mergeToml(existing: string, block: string): string {
  const header = '[mcp_servers.flowkit]';
  const at = existing.indexOf(header);
  if (at !== -1) {
    // Replace from our header to the start of the next table, or the end.
    const next = existing.indexOf('\n[', at + header.length);
    const end = next === -1 ? existing.length : next + 1;
    return existing.slice(0, at) + block + existing.slice(end);
  }
  if (existing.trim() === '') return block;
  return `${existing}${existing.endsWith('\n') ? '' : '\n'}\n${block}`;
}

/** Write the config for the named client, wherever it lives, merging into what
 *  is there. Returns 0 on success. */
export async function writeConfig(o: Opts): Promise<number> {
  const client = resolveClient(o.client);
  if (!client) {
    console.error(`Unknown client "${o.client}". Known: ${CLIENT_NAMES.join(', ')}.`);
    return 1;
  }

  const file = client.where(resolve(o.dir), homeOf(o));
  const designs = designsOf(o);
  const parentExisted = await exists(dirname(file));

  let next: string;
  if (client.format === 'toml') {
    const current = (await exists(file)) ? await readFile(file, 'utf8') : '';
    next = mergeToml(current, tomlBlock(designs, o.npx));
  } else {
    let doc: Record<string, unknown> = {};
    if (await exists(file)) {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
        // A file that parses to null, an array, or a primitive is not a config
        // object we can merge into — treat it as unusable rather than crash on
        // doc[key].
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        doc = parsed as Record<string, unknown>;
      } catch {
        console.error(`${file} is not a valid config object. Fix or remove it, then run again.`);
        return 1;
      }
    }
    const key = client.format === 'opencode' ? 'mcp' : 'mcpServers';
    const had = typeof doc[key] === 'object' && doc[key] !== null ? (doc[key] as object) : {};
    doc[key] = { ...had, flowkit: entry(client.format, designs, o.npx) };
    next = `${JSON.stringify(doc, null, 2)}\n`;
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next, 'utf8');

  console.log(`Wrote ${file}\n  designs: ${designs}`);
  if (client.home && !parentExisted) {
    console.log(`(Created ${dirname(file)} — check that ${o.client} is installed.)`);
  }
  if (client.note) console.log(client.note);
  return 0;
}
