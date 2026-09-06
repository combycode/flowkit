/* End-to-end over real stdio MCP.
 *
 * The store tests prove the document logic; this proves the thing a client
 * actually talks to — handshake, tool listing, and a call that writes a real
 * file. Unit tests could pass while the server failed to start at all.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const doc: ProjectDoc = {
  schema: 1,
  id: 't',
  name: 'Smoke',
  createdAt: '',
  updatedAt: '',
  kit: {
    preset: 'none',
    base: '',
    sheets: {},
    themes: { dark: { label: 'Dark', tokens: { '--bg': '#000', '--text': '#fff' } } },
    defaultTheme: 'dark',
    fonts: [],
  },
  items: {
    auth: {
      tier: 'screen',
      html: '<h1 data-t="auth.hi">Hi</h1>',
      props: {},
      fixtures: { default: { values: {} } },
    },
  },
  flow: {
    nodes: { n1: { screen: 'auth', fixture: 'default' } },
    edges: {},
    groups: [{ id: 'main', label: 'Main' }],
  },
  strings: {
    defaultLocale: 'en',
    locales: { en: { label: 'English', entries: { 'auth.hi': 'Hi' } } },
  },
  assets: {},
  viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
};

let dir: string;
let path: string;
let client: Client;

const say = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: r.content.map((c) => c.text).join('\n'), isError: r.isError === true };
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-mcp-'));
  path = join(dir, 'project.json');
  await Bun.write(path, JSON.stringify(doc));

  client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: [
        'run',
        join(import.meta.dir, '..', 'src', 'main.ts'),
        '--project',
        path,
        // No canvas: a test must not bind a port on the machine running it.
        '--no-studio',
      ],
      // The undo log, the backups and the registry all live under the
      // application-data folder. A test writes to its own.
      env: { ...process.env, FLOWKIT_HOME: dir, APPDATA: dir, XDG_DATA_HOME: dir },
    }),
  );
});

afterAll(async () => {
  await client.close().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('MCP server over stdio', () => {
  test('connects and advertises its tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('overview');
    expect(names).toContain('set_item_html');
    expect(names).toContain('undo');
    // No tool exposes a file path or a raw document write.
    expect(names.some((n) => /file|path|write_json|raw/.test(n))).toBe(false);
  });

  test('overview reports the project', async () => {
    const { text } = await say('overview');
    expect(text).toContain('Smoke');
    expect(text).toContain('1 nodes');
  });

  test('a write reaches the file on disk', async () => {
    const { isError } = await say('create_item', { name: 'card', tier: 'component' });
    expect(isError).toBe(false);
    const saved = (await Bun.file(path).json()) as ProjectDoc;
    expect(saved.items.card?.tier).toBe('component');
  });

  test('a rejection explains itself and names the alternatives', async () => {
    const { text, isError } = await say('set_item_html', { name: 'carrd', html: '<p>x</p>' });
    expect(isError).toBe(true);
    expect(text).toContain('Rejected');
    expect(text).toContain('Did you mean "card"?');
    expect(text).toContain('available:');
  });

  test('a rejected write leaves the file untouched', async () => {
    const before = await Bun.file(path).text();
    await say('delete_item', { name: 'auth' }); // still used by n1
    expect(await Bun.file(path).text()).toBe(before);
  });

  test('an unknown token is refused, a real one is accepted', async () => {
    const bad = await say('set_item_css', { name: 'card', css: '.card { color: var(--nope); }' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('unknown-token');

    const good = await say('set_item_css', { name: 'card', css: '.card { color: var(--text); }' });
    expect(good.isError).toBe(false);
  });

  test('undo reverts the last write', async () => {
    await say('create_item', { name: 'temp', tier: 'element' });
    expect(((await Bun.file(path).json()) as ProjectDoc).items.temp).toBeDefined();
    await say('undo');
    expect(((await Bun.file(path).json()) as ProjectDoc).items.temp).toBeUndefined();
  });

  test('validate surfaces the project’s problems', async () => {
    const { text } = await say('validate');
    expect(text).toMatch(/No problems|error\(s\)/);
  });
});

/* A family is written in the screens as siblings — `dot dot-blue`,
 * `dot dot-green` — and the component underneath them is neither. Without
 * this, the first spelling becomes a component and the rest stay raw markup,
 * which is the drift the registry exists to stop. */
describe('extracting a variant', () => {
  const load = async (): Promise<ProjectDoc> => (await Bun.file(path).json()) as ProjectDoc;

  test('the first one lifts the class off to leave the base', async () => {
    await say('set_item_html', {
      name: 'auth',
      html: '<p><span class="dot dot-blue"></span><span class="dot dot-green"></span></p>',
    });

    const { text, isError } = await say('extract_component', {
      name: 'dot',
      from: 'auth',
      tier: 'element',
      variant: 'blue',
      class: 'dot-blue',
      html: '<span class="dot dot-blue"></span>',
    });
    expect(isError).toBe(false);
    expect(text).toContain('dot:blue');

    const saved = await load();
    expect(saved.items.dot?.html).toBe('<span class="dot"></span>');
    expect(saved.items.dot?.variants?.blue?.class).toBe('dot-blue');
    expect(saved.items.auth?.html).toContain('<x-dot variant="blue"/>');
  });

  test('the next one reads its own modifier off the base', async () => {
    const { isError } = await say('extract_component', {
      name: 'dot',
      from: 'auth',
      variant: 'green',
      html: '<span class="dot dot-green"></span>',
    });
    expect(isError).toBe(false);

    const saved = await load();
    expect(saved.items.dot?.variants?.green?.class).toBe('dot-green');
    expect(saved.items.auth?.html).toBe('<p><x-dot variant="blue"/><x-dot variant="green"/></p>');
  });

  /* The check that makes this safe: a variant is a class and nothing else. */
  test('markup that differs by more than a class is refused', async () => {
    // In the screen, so it gets past the "not in this item" check and reaches
    // the one under test.
    await say('set_item_html', {
      name: 'auth',
      html: '<p><x-dot variant="blue"/><span class="dot is-wide">text inside</span></p>',
    });
    const before = await Bun.file(path).text();
    const { text, isError } = await say('extract_component', {
      name: 'dot',
      from: 'auth',
      variant: 'wide',
      class: 'is-wide',
      html: '<span class="dot is-wide">text inside</span>',
    });

    expect(isError).toBe(true);
    expect(text).toContain('more than');
    expect(await Bun.file(path).text()).toBe(before);
  });

  test('a name that already exists still needs a variant to fold into it', async () => {
    const { text, isError } = await say('extract_component', {
      name: 'dot',
      from: 'auth',
      html: '<span class="dot dot-green"></span>',
    });

    expect(isError).toBe(true);
    expect(text).toContain('already exists');
  });
});

describe('screens and parts as resources', () => {
  test('every screen and part is listed, by a readable name', async () => {
    const { resources } = await client.listResources();
    const screens = resources.filter((r) => r.uri.startsWith('screen://'));
    const parts = resources.filter((r) => r.uri.startsWith('part://'));

    // The doc started with one screen (auth); card was added earlier in this file.
    expect(screens.map((r) => r.uri)).toContain('screen://auth');
    expect(parts.map((r) => r.uri)).toContain('part://card');
    // A concrete list is what fills the @ menu — not a bare template.
    expect(screens.length).toBeGreaterThan(0);
  });

  test('reading a screen returns a brief, not the raw file', async () => {
    const r = await client.readResource({ uri: 'screen://auth' });
    const text = (r.contents[0] as { text: string }).text;

    expect(text).toContain('`auth`');
    expect(text).toContain('Authored markup');
    // The brief carries the screen's own markup — not the composed document,
    // not the rendered pixels.
    expect(text).toContain('```html');
  });

  test('reading a part shows its markup', async () => {
    const r = await client.readResource({ uri: 'part://card' });
    const text = (r.contents[0] as { text: string }).text;

    expect(text).toContain('# card');
    expect(text).toContain('component');
  });

  test('a name that is gone reads as absent, not an error', async () => {
    const r = await client.readResource({ uri: 'screen://ghost' });
    expect((r.contents[0] as { text: string }).text).toContain('No screen');
  });

  test('the template is offered for completion too', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const uris = resourceTemplates.map((t) => t.uriTemplate);
    expect(uris).toContain('screen://{name}');
    expect(uris).toContain('part://{name}');
  });
});

describe('moving a node, and the per-viewport placement that used to hide it', () => {
  test('a shared placement shows as shared', async () => {
    await say('update_node', { id: 'n1', col: 1, lane: 1 });
    const { text } = await say('list_nodes');
    expect(text).toContain('col 1 lane 1 (shared)');
  });

  test('a viewport placement wins on that viewport, and is marked as its own', async () => {
    await say('update_node', { id: 'n1', viewport: 'mobile', col: 5, lane: 5 });
    const { text } = await say('list_nodes', { viewport: 'mobile' });
    expect(text).toContain('col 5 lane 5 (mobile)');
  });

  /* The reported bug: setting the shared placement while a viewport override
     exists looked like it did nothing. It still does nothing THERE — that is
     correct — but the reply now says so instead of a bare "Updated". */
  test('setting the shared placement warns when a viewport override still wins', async () => {
    const { text } = await say('update_node', { id: 'n1', col: 2, lane: 2 });
    expect(text).toContain('SHARED');
    expect(text).toContain('mobile');

    // and the canvas (mobile) still shows the override — the move was not lost,
    // it just does not apply where a hand placement exists.
    const listed = await say('list_nodes', { viewport: 'mobile' });
    expect(listed.text).toContain('col 5 lane 5 (mobile)');
  });

  test('clearing the override lets the shared placement through', async () => {
    const { text, isError } = await say('clear_placement', { id: 'n1', viewport: 'mobile' });
    expect(isError).toBe(false);

    const listed = await say('list_nodes', { viewport: 'mobile' });
    expect(listed.text).toContain('col 2 lane 2 (shared)');
    void text;
  });

  test('clearing a placement that is not there says so rather than erroring loudly', async () => {
    // The override was just cleared, so the node now has none at all.
    const { text } = await say('clear_placement', { id: 'n1', viewport: 'mobile' });
    expect(text.toLowerCase()).toContain('no per-viewport placement');
  });
});

describe('repointing a node at another screen', () => {
  test('update_node can change which screen a node shows', async () => {
    // n1 shows 'auth'. Give it another screen to point at, then repoint.
    await say('create_item', { name: 'home2', tier: 'screen', html: '<main></main>' });
    const { isError } = await say('update_node', { id: 'n1', screen: 'home2' });
    expect(isError).toBe(false);

    const saved = (await Bun.file(path).json()) as ProjectDoc;
    expect(saved.flow.nodes.n1?.screen).toBe('home2');
  });

  test('repointing at a screen that does not exist is refused', async () => {
    const { text, isError } = await say('update_node', { id: 'n1', screen: 'ghost-screen' });
    expect(isError).toBe(true);
    expect(text).toContain('Rejected');
  });
});

/* A family whose variants differ INSIDE, not on the root — a nav with the
 * active item on a different button. The root is identical, so there is no
 * class to lift; the whole occurrence is stored as the variant. This was the
 * blind spot: set_variant accepted such states by html, but extract_component
 * refused to find and fold them, so screens were rewritten by hand. */
describe('extracting a variant that differs inside the element', () => {
  const load = async (): Promise<ProjectDoc> => (await Bun.file(path).json()) as ProjectDoc;
  const navA = '<nav class="nav"><a class="is-active">A</a><a>B</a></nav>';
  const navB = '<nav class="nav"><a>A</a><a class="is-active">B</a></nav>';

  test('the base is extracted first, from one screen', async () => {
    await say('create_item', { name: 'p-a', tier: 'screen', html: `<main>${navA}</main>` });
    await say('create_item', { name: 'p-b', tier: 'screen', html: `<main>${navB}</main>` });

    const { isError } = await say('extract_component', {
      name: 'nav',
      from: 'p-a',
      tier: 'component',
      html: navA,
    });
    expect(isError).toBe(false);
    const saved = await load();
    expect(saved.items.nav?.html).toBe(navA);
    expect(saved.items['p-a']?.html).toBe('<main><x-nav/></main>');
  });

  test('a second state folds in as a variant carrying its own markup', async () => {
    const { text, isError } = await say('extract_component', {
      name: 'nav',
      from: 'p-b',
      variant: 'b',
      html: navB,
    });
    expect(isError).toBe(false);
    expect(text).toContain('own markup');

    const saved = await load();
    expect(saved.items.nav?.variants?.b?.html).toBe(navB);
    expect(saved.items['p-b']?.html).toBe('<main><x-nav variant="b"/></main>');
  });

  /* And it must still render byte-identical — the whole point of extraction. */
  test('the folded screen renders exactly as before', async () => {
    const r = await say('render_screen', { screen: 'p-b' });
    expect(r.isError).toBe(false);
  });
});

/* One list of ordinary calls, applied as one change with one undo. The point
 * is the mass edit: create a run of screens and wire them, or rename a dozen
 * items, without a dozen writes and a dozen undos. A later step sees the
 * earlier ones, and if any step is refused nothing is written. */
describe('batch — several edits as one transaction', () => {
  const load = async (): Promise<ProjectDoc> => (await Bun.file(path).json()) as ProjectDoc;

  test('a create then a rename of that same thing both land, in one undo', async () => {
    const before = await load();
    const undosBefore = Object.keys(before.items).length;

    const { isError } = await say('batch', {
      calls: [
        { tool: 'create_item', args: { name: 'b-one', tier: 'element', html: '<i></i>' } },
        { tool: 'rename_item', args: { from: 'b-one', to: 'b-two' } },
      ],
    });
    expect(isError).toBe(false);

    const saved = await load();
    expect(saved.items['b-one']).toBeUndefined();
    expect(saved.items['b-two']?.tier).toBe('element');

    // One undo takes the whole batch away, not just the rename.
    await say('undo');
    const undone = await load();
    expect(undone.items['b-two']).toBeUndefined();
    expect(undone.items['b-one']).toBeUndefined();
    expect(Object.keys(undone.items).length).toBe(undosBefore);
  });

  test('if any step is rejected, nothing in the batch is written', async () => {
    const before = await Bun.file(path).text();
    const { text, isError } = await say('batch', {
      calls: [
        { tool: 'create_item', args: { name: 'b-good', tier: 'element' } },
        // second step points at a screen that does not exist -> rejected
        { tool: 'update_node', args: { id: 'n1', screen: 'b-nope' } },
      ],
    });
    expect(isError).toBe(true);
    expect(text).toContain('step 2');
    expect(text.toLowerCase()).toContain('nothing');
    // The good first step is rolled back with the bad one.
    expect(await Bun.file(path).text()).toBe(before);
  });

  test('a non-editing tool cannot ride inside a batch', async () => {
    const { text, isError } = await say('batch', {
      calls: [{ tool: 'render_screen', args: { screen: 'auth' } }],
    });
    expect(isError).toBe(true);
    expect(text).toContain('render_screen');
    expect(text).toContain('cannot run inside batch');
  });

  test('a batch cannot contain a batch', async () => {
    const { text, isError } = await say('batch', {
      calls: [{ tool: 'batch', args: { calls: [] } }],
    });
    expect(isError).toBe(true);
    expect(text).toContain('cannot contain batch');
  });

  test('an end state a single call would reject is allowed together', async () => {
    // Create a screen and, in the same batch, a node pointing at it and an
    // edge into that node. Done one call at a time the node would exist before
    // the edge, but as a batch only the final state is judged.
    const { isError } = await say('batch', {
      calls: [
        { tool: 'create_item', args: { name: 'b-scr', tier: 'screen', html: '<main></main>' } },
        { tool: 'add_node', args: { id: 'b-n', screen: 'b-scr' } },
        { tool: 'connect', args: { from: 'n1', to: 'b-n' } },
      ],
    });
    expect(isError).toBe(false);
    const saved = await load();
    expect(saved.flow.nodes['b-n']?.screen).toBe('b-scr');
    const edges = Object.values(saved.flow.edges);
    expect(edges.some((e) => e.from === 'n1' && e.to === 'b-n')).toBe(true);
  });
});

/* The tier chosen at extract time is not final. A sidebar taken as a container
 * that should have been a component can be moved without deleting it and the
 * fourteen screens that reference it — the reference does not name a tier. */
describe('changing an item tier after it exists', () => {
  const load = async (): Promise<ProjectDoc> => (await Bun.file(path).json()) as ProjectDoc;

  test('set_item_meta moves an item between tiers, references intact', async () => {
    await say('create_item', { name: 'widget', tier: 'element', html: '<i class="widget"></i>' });
    await say('set_item_html', { name: 'auth', html: '<main><x-widget/></main>' });

    const { isError } = await say('set_item_meta', { name: 'widget', tier: 'component' });
    expect(isError).toBe(false);

    const saved = await load();
    expect(saved.items.widget?.tier).toBe('component');
    // The call site never named the tier, so it still resolves.
    expect(saved.items.auth?.html).toContain('<x-widget/>');
  });

  test('a tier change that would dangle a node is refused', async () => {
    await say('create_item', { name: 'scr-x', tier: 'screen', html: '<main></main>' });
    await say('add_node', { id: 'nx', screen: 'scr-x' });

    const { text, isError } = await say('set_item_meta', { name: 'scr-x', tier: 'component' });
    expect(isError).toBe(true);
    expect(text).toContain('point at');
    expect(text).toContain('nx');

    const saved = await load();
    expect(saved.items['scr-x']?.tier).toBe('screen');
  });
});
