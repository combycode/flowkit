#!/usr/bin/env bun
/* Flowkit MCP server.
 *
 * Exposes the command layer over stdio so Claude Code (or any MCP client) can
 * work on a project. The client brings its own model; this server holds the
 * documents and is the only thing that writes them.
 *
 *   --workspace <dir>    a folder of projects (recommended)
 *   --project <file>     a single project, for an existing setup
 */

import { mkdir } from 'node:fs/promises';
import {
  defaultPort,
  Sidecar,
  type Studio,
  serveStudio,
  Workspace,
  workspaceDir,
} from '@flowkit/host';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type PromptRegistrar, registerPrompts } from './prompts';
import { registerResources } from './resources';
import { Tasks } from './tasks';
import { registerComponentTools } from './tools/components';
import { registerExportTools } from './tools/exports';
import { registerKitTools } from './tools/kit';
import { registerProjectTools } from './tools/projects';
import { registerReadTools } from './tools/read';
import { registerRecoverTools } from './tools/recover';
import type { Registrar } from './tools/registrar';
import { registerRenderTools } from './tools/render';
import { registerSelectionTools } from './tools/selection';
import { registerStringTools } from './tools/strings';
import { registerStyleTools } from './tools/styles';
import { registerWriteTools } from './tools/write';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const INSTRUCTIONS = `Work on Flowkit projects: screens, their connections, the design
tokens they are styled from, and their translations.

PROJECTS
list_projects shows what exists. open_project selects one for later calls; every
tool also takes an explicit \`project\` that overrides the selection for that call.
Writes report which project they changed, so check that line if you are moving
between several.

RULES the project enforces, so following them avoids rejected calls:
- Colours and sizes come from TOKENS. In item CSS write var(--bg), never #08090d.
  get_tokens lists what exists.
- Every visible string carries a data-t key: <h1 data-t="auth.title">Sign in</h1>.
  Text without one cannot be translated, and validate reports it.
- Item CSS selectors start with the item's own name, so styles cannot leak.
- Item names are unique across tiers, because a template refers to an item by
  name alone.
- A canvas node must point at an item of tier "screen".

COMPOSING
A screen is drawn from the registry, not copied. Three constructs, and no more:
  <x-button variant="quiet"/>          use a registry item (optionally a variant)
  <x-slot name="body"/>                 a hole an item declares
  <x-fill slot="body">…</x-fill>       fill one of a called item's holes
A variant is a NAMED alternative in the registry (a class, attributes, or its
own markup); there is no interpolation, no conditions, no loops. Anything that
varies is a variant, a fill, or a separate screen. extract_component lifts
repeated markup into a part; set_variant names a state.

TEXT PASSED INTO A SLOT MUST BE WRAPPED to carry a key: <x-fill slot="title">
<span data-t="t.x">Save</span></x-fill>, not bare "Save" — a data-t on <x-fill>
is stripped when the screen composes, so the text ends up unkeyed. Or write the
text bare and run extract_strings, which stamps a span-worthy key on unkeyed
text AND backfills entries for keys you wrote by hand.

WORKING
Start with overview — the cheapest way to see the shape of a project. list_items
is names only; get_item is the full markup of one. Read broadly first, narrowly
second.

ALWAYS render_screen after changing markup or CSS. Valid HTML is not a working
layout: only the picture shows text that overflows, a button that wrapped, or
contrast that disappeared. Write, render, look, fix.

Every write is validated and applied whole or refused whole, so a rejection
changes nothing. Refusals name what would have been accepted — read them rather
than guessing again. undo reverts the last write.

PROMPTS
This server also offers prompts, which are worth asking for by name rather than
working it out from the tool list:
  orient         what this project is, before answering anything about it
  explain-flow   walk one journey end to end
  review-screen  check a screen against what this design already decided
  extract-part   lift repeated markup into the registry without changing a pixel
  write-spec     turn the design into something a developer can build from`;

async function main() {
  // No flag means the platform's own application-data folder, which is where
  // the desktop build will look too — dev and shipped differ by a flag.
  const file = arg('project');
  const dir = file ? undefined : workspaceDir(arg('workspace'));
  if (dir) await mkdir(dir, { recursive: true });

  const ws = dir ? await Workspace.at(dir) : await Workspace.single(file as string);
  // Lazy: no browser is started until something is actually rendered.
  const sidecar = new Sidecar();

  const server = new McpServer(
    // Keep in step with packages/mcp-server/package.json — the published version.
    { name: 'flowkit', version: '0.1.2' },
    { instructions: INSTRUCTIONS },
  );
  const registrar = server as unknown as Registrar;

  let studio: Studio | undefined;
  registerProjectTools(registrar, ws, () => studio);
  registerReadTools(registrar, ws);
  registerWriteTools(registrar, ws);
  registerStyleTools(registrar, ws);
  registerStringTools(registrar, ws);
  registerComponentTools(registrar, ws);
  registerKitTools(registrar, ws, sidecar);
  registerRenderTools(registrar, ws, sidecar);
  registerSelectionTools(registrar, ws, sidecar);
  registerRecoverTools(registrar, ws);
  registerExportTools(registrar, ws, sidecar, new Tasks());

  // Not tools: these are for whoever READS a design rather than edits one.
  registerPrompts(server as unknown as PromptRegistrar);

  // Screens and parts as resources, so `@` reaches them by name. The `@` menu
  // refreshes because the registrar fires resources/list_changed on every
  // write (see registrar.ts).
  registerResources(server, ws);

  /* The canvas comes up with the agent.
   *
   * It is the same process, so the studio and these tools share one Workspace
   * and therefore one store and one op-log: a screen dragged on the canvas and
   * a screen moved by a tool are the same operation, and undo covers both.
   *
   * Never fatal. An agent that cannot render a canvas is still an agent that
   * can read and change a design, and refusing to start over a busy port
   * would be a poor trade. */
  try {
    // --no-studio: the tools without the canvas. A test harness spawning this
    // must not bind a port on the developer's machine, and someone driving it
    // from a script has no use for a browser page.
    if (!process.argv.includes('--no-studio')) {
      studio = await serveStudio({ workspace: ws, port: defaultPort(arg('port')) });
    }
  } catch (e) {
    console.error(`Studio not started: ${e instanceof Error ? e.message : String(e)}`);
  }

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    studio?.stop();
    sidecar.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // The client is gone the instant our stdin closes. A GUI client (Claude
  // Desktop) closes the pipe rather than signalling us — and because the canvas
  // is a live Bun.serve, the process (and its port) would otherwise outlive the
  // client forever. Exit when the pipe ends.
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);

  await server.connect(new StdioServerTransport());
}

await main();
