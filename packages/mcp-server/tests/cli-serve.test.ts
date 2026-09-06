/* The CLI is the real entry point — `flowkit` and `flowkit mcp` ARE the server.
 * protocol.test.ts spawns main.ts directly and so cannot catch a CLI dispatch
 * that starts the server and then exits out from under it (which it once did:
 * a process.exit after the import tore the transport down instantly). This
 * spawns cli.ts the way a client does and proves the server stays up long
 * enough to answer. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let dir: string;
let client: Client;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fk-cli-'));
  client = new Client({ name: 'cli-serve-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: ['run', join(import.meta.dir, '..', 'src', 'cli.ts'), 'mcp', '--workspace', dir],
      env: { ...process.env, FLOWKIT_HOME: dir, APPDATA: dir, XDG_DATA_HOME: dir },
    }),
  );
});

afterAll(async () => {
  await client.close().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('flowkit mcp (the CLI as a server)', () => {
  test('stays up and answers listTools', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(50);
    expect(tools.map((t) => t.name)).toContain('overview');
  });

  test('and can still answer a second call — it did not exit after the first', async () => {
    const r = (await client.callTool({ name: 'list_projects' })) as {
      content: { text?: string }[];
    };
    expect(r.content.map((c) => c.text ?? '').join('')).toBeTruthy();
  });
});
