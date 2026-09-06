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

/* The other half: with the canvas up, the server must DIE when its stdin closes
 * (a GUI client that just closes the pipe). Otherwise the process — and its
 * port — outlive the client forever. */
describe('flowkit (server + canvas) exits when its client disconnects', () => {
  test('closing stdin stops the process', async () => {
    const home = await mkdtemp(join(tmpdir(), 'fk-exit-'));
    const port = 5361; // off the default, so a real canvas on 5190 is untouched
    const proc = Bun.spawn(
      [
        'bun',
        join(import.meta.dir, '..', 'src', 'cli.ts'),
        '--workspace',
        home,
        '--port',
        String(port),
      ],
      {
        stdin: 'pipe',
        stdout: 'ignore',
        stderr: 'ignore',
        env: { ...process.env, FLOWKIT_HOME: home, APPDATA: home, XDG_DATA_HOME: home },
      },
    );
    try {
      // Wait for the canvas to be listening — that is the thing that would keep
      // the process alive.
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        up = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) })
          .then((r) => r.ok)
          .catch(() => false);
        if (!up) await new Promise((r) => setTimeout(r, 150));
      }
      expect(up).toBe(true);

      // The client goes away: close the pipe.
      proc.stdin.end();

      // It must exit on its own, promptly.
      const exited = await Promise.race([
        proc.exited,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 8000)),
      ]);
      expect(exited).not.toBe('timeout');
    } finally {
      proc.kill();
      await rm(home, { recursive: true, force: true });
    }
  }, 25000);
});
