/* Screens and parts as MCP resources — so a person can write `@` and reach a
 * screen by name, and the agent can pull it on demand.
 *
 * Measured, not assumed (see the spike): the `@` menu is filled by the CONCRETE
 * entries a resource template's `list` callback returns, one per screen; a bare
 * template shows only as an un-completable prefix, so listing them is the point.
 * The menu stays live because a change fires `notifications/resources/list_changed`
 * and the client refetches — wired in the registrar, on every write.
 *
 * The content is read FROM THE DOCUMENT each time, never cached in memory: each
 * client spawns its own server process, so a value held here would drift from
 * the canvas. What a resource returns is a compact brief — what the screen is,
 * what it connects to, what it is built from, and its authored markup — not the
 * rendered pixels (that is what render_screen is for) and not the whole
 * composed document (megabytes of inlined font).
 */

import { expand, type FlowNode, type Item, type ProjectDoc } from '@flowkit/core';
import type { Workspace } from '@flowkit/host';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

/** The slice of McpServer this needs. Kept narrow so main.ts can pass the
 *  server it already has without a new type dependency. */
export interface ResourceHost {
  registerResource(
    name: string,
    template: ResourceTemplate,
    config: { title?: string; description?: string; mimeType?: string },
    read: (
      uri: URL,
      variables: Record<string, string | string[]>,
    ) => Promise<{ contents: { uri: string; mimeType?: string; text: string }[] }>,
  ): unknown;
}

/* The scheme IS the type. The client shows `flowkit:<uri>` in the @ menu, so
 * `flowkit://screen/x` rendered as `flowkit:flowkit://screen/x` — the name
 * drowned in a doubled prefix. Making the scheme `screen` gives
 * `flowkit:screen://first-run`: the type reads plainly, and the name has room. */
const SCREEN = 'screen://{name}';
const PART = 'part://{name}';

/** The active project's document, or undefined when none is settled — a menu
 *  with nothing in it is the right answer, not an error. */
async function activeDoc(ws: Workspace): Promise<ProjectDoc | undefined> {
  try {
    return (await ws.require()).store.get();
  } catch {
    return undefined;
  }
}

export function registerResources(server: ResourceHost, ws: Workspace): void {
  server.registerResource(
    'screen',
    new ResourceTemplate(SCREEN, {
      list: async () => {
        const doc = await activeDoc(ws);
        if (!doc) return { resources: [] };
        return {
          // The description is the only text the @ menu shows in full, so it
          // holds the READABLE NAME — not the flow or the number of ways out,
          // which is noise when you are just trying to name a screen.
          resources: Object.values(doc.flow.nodes).map((node) => ({
            uri: `screen://${node.screen}`,
            name: node.title ?? node.screen,
            title: node.title ?? node.screen,
            description: node.title && node.title !== node.screen ? node.title : '',
            mimeType: 'text/markdown',
          })),
        };
      },
    }),
    {
      title: 'Screens',
      description: 'Each screen in the design, by name.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const doc = await activeDoc(ws);
      const name = one(variables.name);
      const node = doc && Object.entries(doc.flow.nodes).find(([, n]) => n.screen === name);
      if (!doc || !node) return missing(uri, `screen "${name}"`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: screenDoc(doc, node[0], node[1]) },
        ],
      };
    },
  );

  server.registerResource(
    'part',
    new ResourceTemplate(PART, {
      list: async () => {
        const doc = await activeDoc(ws);
        if (!doc) return { resources: [] };
        return {
          resources: Object.entries(doc.items)
            .filter(([, item]) => item.tier !== 'screen')
            .map(([name, item]) => ({
              uri: `part://${name}`,
              name,
              title: name,
              description: item.tier,
              mimeType: 'text/markdown',
            })),
        };
      },
    }),
    {
      title: 'Parts',
      description: 'Components, elements and layouts, by name.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const doc = await activeDoc(ws);
      const name = one(variables.name);
      const item = doc?.items[name];
      if (!doc || !item || item.tier === 'screen') return missing(uri, `part "${name}"`);
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: partDoc(name, item) }],
      };
    },
  );
}

/* ── what a screen resource says when READ (not in the menu) ────────────── */

function screenDoc(doc: ProjectDoc, id: string, node: FlowNode): string {
  const item = doc.items[node.screen];
  const title = node.title ?? node.screen;
  const out: string[] = [`# ${title}`, '', `\`${node.screen}\``];
  if (node.description) out.push('', node.description);

  const facts: string[] = [];
  const flows = (node.groups ?? []).map((g) => flowLabel(doc, g));
  if (flows.length > 0) facts.push(`- **Flow** — ${flows.join(', ')}`);
  if (node.viewport ?? item?.viewport)
    facts.push(`- **Designed at** — ${node.viewport ?? item?.viewport}`);
  for (const [key, value] of Object.entries({ ...item?.meta, ...node.meta })) {
    facts.push(`- **${key}** — ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  if (facts.length > 0) out.push('', ...facts);

  const name = (other: string) => doc.flow.nodes[other]?.title ?? other;
  const going = Object.values(doc.flow.edges).filter((e) => e.from === id);
  const coming = Object.values(doc.flow.edges).filter((e) => e.to === id);
  if (coming.length > 0) {
    out.push(
      '',
      `**Reached from** — ${coming.map((e) => `${name(e.from)}${e.label ? ` (${e.label})` : ''}`).join(', ')}`,
    );
  }
  if (going.length > 0) {
    out.push(
      '',
      '**Leads to**',
      ...going.map((e) => `- ${e.label ? `**${e.label}** → ` : ''}${name(e.to)}`),
    );
  }

  if (item) {
    const built = builtFrom(doc, item);
    if (built.length > 0)
      out.push('', `**Built from** — ${built.map((n) => `\`${n}\``).join(', ')}`);
    out.push('', 'Authored markup:', '', '```html', item.html.trim(), '```');
  }
  return out.join('\n');
}

/* ── what a part resource says ──────────────────────────────────────────── */

function partDoc(name: string, item: Item): string {
  const out: string[] = [`# ${name}`, '', `\`${item.tier}\``];
  if (item.description) out.push('', item.description);

  const states = Object.keys(item.variants ?? {});
  if (states.length > 0) out.push('', `**States** — ${states.join(', ')}`);
  if (item.cssPrefix) out.push('', `**CSS prefix** — \`${item.cssPrefix}\``);
  for (const [key, value] of Object.entries(item.meta ?? {})) {
    out.push('', `**${key}** — ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }

  out.push('', 'Markup:', '', '```html', item.html.trim(), '```');
  if (item.css?.trim()) out.push('', 'CSS:', '', '```css', item.css.trim(), '```');
  return out.join('\n');
}

/* ── shared ─────────────────────────────────────────────────────────────── */

const flowLabel = (doc: ProjectDoc, id: string): string =>
  doc.flow.groups.find((g) => g.id === id)?.label ?? id;

/** The registry items a screen composes, in order. */
function builtFrom(doc: ProjectDoc, item: Item): string[] {
  if (!item.html.includes('<x-')) return [];
  return [...new Set(expand(doc, item.html, item).used)];
}

const one = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

const missing = (uri: URL, what: string) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: 'text/markdown',
      text: `No ${what} in the active project. It may have been renamed or removed.`,
    },
  ],
});
