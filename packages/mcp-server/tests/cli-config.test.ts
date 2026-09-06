/* The per-client MCP config generator. Each client reads its own file in its
 * own shape; getting one wrong means an editor that silently sees no tools. */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitConfig, writeConfig } from '../src/cli/config';

const tmp = () => mkdtemp(join(tmpdir(), 'fk-cfg-'));

describe('writeConfig — clients that read the repo', () => {
  test('claude-code writes .mcp.json with the global flowkit command', async () => {
    const dir = await tmp();
    const code = await writeConfig({ client: 'claude-code', dir, npx: false });
    expect(code).toBe(0);

    const doc = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'));
    expect(doc.mcpServers.flowkit.command).toBe('flowkit');
    expect(doc.mcpServers.flowkit.args[0]).toBe('--workspace');
    expect(doc.mcpServers.flowkit.args[1]).toContain('design');
    await rm(dir, { recursive: true, force: true });
  });

  test('an existing .mcp.json keeps its other servers', async () => {
    const dir = await tmp();
    await writeFile(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
    );
    await writeConfig({ client: 'claude-code', dir, npx: false });

    const doc = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'));
    expect(doc.mcpServers.other.command).toBe('x');
    expect(doc.mcpServers.flowkit.command).toBe('flowkit');
    await rm(dir, { recursive: true, force: true });
  });

  test('opencode uses its own shape — mcp, type local, command array', async () => {
    const dir = await tmp();
    await writeConfig({ client: 'opencode', dir, npx: false });

    const doc = JSON.parse(await readFile(join(dir, 'opencode.json'), 'utf8'));
    expect(doc.mcp.flowkit.type).toBe('local');
    expect(Array.isArray(doc.mcp.flowkit.command)).toBe(true);
    expect(doc.mcp.flowkit.command[0]).toBe('flowkit');
    await rm(dir, { recursive: true, force: true });
  });

  test('--npx invokes through bunx', async () => {
    const dir = await tmp();
    await writeConfig({ client: 'cursor', dir, npx: true });
    const doc = JSON.parse(await readFile(join(dir, '.cursor', 'mcp.json'), 'utf8'));
    expect(doc.mcpServers.flowkit.command).toBe('bunx');
    expect(doc.mcpServers.flowkit.args[0]).toBe('@combycode/flowkit');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('writeConfig — clients whose file is in the home directory', () => {
  test('codex writes ~/.codex/config.toml as a TOML table', async () => {
    const dir = await tmp();
    const home = await tmp();
    const code = await writeConfig({ client: 'codex', dir, npx: false, home });
    expect(code).toBe(0);

    const toml = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.flowkit]');
    expect(toml).toContain('command = "flowkit"');
    expect(toml).toContain('"--workspace"');
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  test('a TOML merge keeps another server already in the file', async () => {
    const dir = await tmp();
    const home = await tmp();
    const { mkdir, writeFile: write } = await import('node:fs/promises');
    await mkdir(join(home, '.codex'), { recursive: true });
    await write(
      join(home, '.codex', 'config.toml'),
      '# my codex config\n[mcp_servers.other]\ncommand = "x"\n',
    );

    await writeConfig({ client: 'codex', dir, npx: false, home });
    const toml = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.other]'); // survived
    expect(toml).toContain('command = "x"');
    expect(toml).toContain('[mcp_servers.flowkit]'); // added
    expect(toml).toContain('# my codex config'); // comment survived
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  test('re-running replaces the flowkit table rather than duplicating it', async () => {
    const dir = await tmp();
    const home = await tmp();
    await writeConfig({ client: 'codex', dir, npx: false, home });
    await writeConfig({ client: 'codex', dir, npx: true, home });
    const toml = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml.match(/\[mcp_servers\.flowkit\]/g)?.length).toBe(1);
    expect(toml).toContain('command = "bunx"'); // the second write won
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  test('windsurf writes its home JSON file, merging', async () => {
    const dir = await tmp();
    const home = await tmp();
    await writeConfig({ client: 'windsurf', dir, npx: false, home });
    const doc = JSON.parse(
      await readFile(join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'utf8'),
    );
    expect(doc.mcpServers.flowkit.command).toBe('flowkit');
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });
});

describe('unknown client', () => {
  test('is refused', async () => {
    expect(await writeConfig({ client: 'nope', dir: '.', npx: false })).toBe(1);
    expect(emitConfig({ client: 'nope', dir: '.', npx: false })).toBe(1);
  });
});
