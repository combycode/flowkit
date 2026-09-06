#!/usr/bin/env bun

/* `flowkit serve` — the studio on its own.
 *
 * The MCP server starts this too, so the canvas is there whenever an agent
 * is. But the design outlives the conversation: you should be able to open
 * yesterday's flow, read it, move a screen, and send it to someone, without
 * starting Claude Code to do it.
 *
 * Same server either way, and only ever one of it: if a studio is already
 * listening, this says so and exits rather than starting a second writer.
 */

import { defaultPort } from '../paths';
import { Workspace } from '../workspace';
import { serveStudio } from './studio';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const workspace = await Workspace.at(arg('workspace'));
const studio = await serveStudio({ workspace, port: defaultPort(arg('port')) });

const projects = await workspace.list();

if (studio.adopted) {
  console.log(`A studio is already running at ${studio.url} — using that one.`);
} else {
  console.log(`Studio:   ${studio.url}`);
}
console.log(
  projects.length > 0
    ? `Projects: ${projects.map((p) => p.id).join(', ')}\n` +
        `Open:     ${studio.url}/?project=${projects[0]?.id}`
    : 'Projects: none yet. Create one through the MCP server, or import a design.',
);

if (studio.adopted) process.exit(0);
console.log('\nCtrl-C to stop.');
