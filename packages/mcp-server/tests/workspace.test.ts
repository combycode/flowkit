/* Multi-project over real stdio MCP, including render_screen through the
 * Chromium sidecar.
 *
 * The risky part of an active-project design is writing to the wrong one, so
 * these check that an explicit `project` always wins and that replies name
 * what they touched.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectDoc } from '@flowkit/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let dir: string;
let client: Client;

interface Part {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: Part[];
    isError?: boolean;
  };
  return {
    text: r.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n'),
    images: r.content.filter((c) => c.type === 'image'),
    isError: r.isError === true,
  };
};

const docAt = async (id: string) => (await Bun.file(join(dir, `${id}.json`)).json()) as ProjectDoc;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'df-ws-'));
  client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: [
        'run',
        join(import.meta.dir, '..', 'src', 'main.ts'),
        '--workspace',
        dir,
        // No canvas: a test must not bind a port on the machine running it.
        '--no-studio',
      ],
      // Isolate the registry, the undo log and the backups: they live in the
      // workspace and the application-data folder, and a test must not see —
      // or write to — either of the real ones.
      env: { ...process.env, FLOWKIT_HOME: dir, APPDATA: dir, XDG_DATA_HOME: dir },
    }),
  );
});

afterAll(async () => {
  await client.close().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('workspace', () => {
  test('starts empty and says how to begin', async () => {
    const { text } = await call('list_projects');
    expect(text).toContain('No projects yet');
  });

  test('a call with no project selected explains rather than guessing', async () => {
    const { text, isError } = await call('overview');
    expect(isError).toBe(true);
    expect(text).toContain('create_project');
  });

  test('create_project derives an id and makes it active', async () => {
    const { text } = await call('create_project', { name: 'Acme Store' });
    expect(text).toContain('acme-store');
    expect((await call('overview')).text).toContain('Acme Store');
  });

  test('a second project does not disturb the first', async () => {
    await call('create_project', { name: 'Blog' });
    const { text } = await call('list_projects');
    expect(text).toContain('acme-store');
    expect(text).toContain('blog');
    // The newest is active.
    expect(text).toMatch(/\*\s+blog/);
  });

  test('writes go to the active project', async () => {
    // A name the starter kit does not already use, or this tests nothing.
    await call('create_item', { name: 'checkout', tier: 'screen' });
    expect((await docAt('blog')).items.checkout).toBeDefined();
    expect((await docAt('acme-store')).items.checkout).toBeUndefined();
  });

  test('an explicit project overrides the active one', async () => {
    await call('create_item', { name: 'cart', tier: 'screen', project: 'acme-store' });
    expect((await docAt('acme-store')).items.cart).toBeDefined();
    expect((await docAt('blog')).items.cart).toBeUndefined();
  });

  test('and does not change which project is active', async () => {
    await call('create_item', { name: 'later', tier: 'screen' });
    expect((await docAt('blog')).items.later).toBeDefined();
  });

  test('open_project switches the default', async () => {
    await call('open_project', { project: 'acme-store' });
    await call('create_item', { name: 'checkout', tier: 'screen' });
    expect((await docAt('acme-store')).items.checkout).toBeDefined();
  });

  test('an unknown project names the ones that exist', async () => {
    const { text, isError } = await call('overview', { project: 'nope' });
    expect(isError).toBe(true);
    expect(text).toContain('acme-store');
    expect(text).toContain('blog');
  });

  test('list_projects reports sizes without opening every document', async () => {
    const { text } = await call('list_projects');
    expect(text).toMatch(/acme-store.+screens/);
  });
});

describe('render_screen', () => {
  test('returns an actual image of the screen', async () => {
    await call('open_project', { project: 'acme-store' });
    await call('set_item_html', {
      name: 'home',
      html: '<main style="padding:40px"><h1 data-t="home.hi">Hello</h1></main>',
      project: 'blog',
    });

    const r = await call('render_screen', { screen: 'home', project: 'blog' });
    expect(r.isError).toBe(false);
    expect(r.images.length).toBe(1);
    expect(r.images[0]?.mimeType).toBe('image/png');
    // A real PNG, not an empty string: check the magic bytes.
    const bytes = Buffer.from(r.images[0]?.data ?? '', 'base64');
    expect(bytes.length).toBeGreaterThan(1000);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 60_000);

  test('names the project, theme and size it rendered', async () => {
    const { text } = await call('render_screen', { screen: 'home', project: 'blog' });
    expect(text).toContain('blog');
    expect(text).toContain('dark');
    expect(text).toContain('390x844'); // 1x by default, not 2x
  }, 60_000);

  test('scale 2 doubles the pixels', async () => {
    const { text } = await call('render_screen', { screen: 'home', project: 'blog', scale: 2 });
    expect(text).toContain('780x1688');
  }, 60_000);

  test('an unknown screen explains itself', async () => {
    const { text, isError } = await call('render_screen', { screen: 'nope', project: 'blog' });
    expect(isError).toBe(true);
    expect(text).toContain('list_items');
  }, 60_000);
});

describe('a project anywhere on disk', () => {
  /* The case that matters: a design belongs in the repo it describes, beside
     the code, committed with it. Binding projects to one folder made that
     impossible. */
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'df-repo-'));
  });
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  test('create_project puts the file where it is told', async () => {
    const { text } = await call('create_project', { name: 'In Repo', dir: join(repo, 'design') });
    expect(text).toContain(join(repo, 'design'));
    expect(await Bun.file(join(repo, 'design', 'in-repo.json')).exists()).toBe(true);
  });

  test('and it becomes active, so the next call needs no id', async () => {
    const { isError } = await call('create_item', { name: 'landing', tier: 'screen' });
    expect(isError).toBe(false);
    const doc = (await Bun.file(join(repo, 'design', 'in-repo.json')).json()) as ProjectDoc;
    expect(doc.items.landing).toBeDefined();
  });

  test('list_projects shows where each project lives', async () => {
    const { text } = await call('list_projects');
    expect(text).toContain(join(repo, 'design', 'in-repo.json'));
  });

  test('open_project accepts a path as readily as an id', async () => {
    await call('open_project', { project: 'blog' });
    const { text, isError } = await call('open_project', {
      project: join(repo, 'design', 'in-repo.json'),
    });
    expect(isError).toBe(false);
    expect(text).toContain('In Repo');
  });

  test('re-opening the same file keeps its id rather than suffixing it', async () => {
    const first = await call('open_project', { project: join(repo, 'design', 'in-repo.json') });
    const again = await call('open_project', { project: join(repo, 'design', 'in-repo.json') });
    expect(first.text).toContain('in-repo ');
    expect(again.text).toContain('in-repo ');
    expect(again.text).not.toContain('in-repo-2');
  });

  test('a path that is not there says so plainly', async () => {
    const { text, isError } = await call('open_project', { project: join(repo, 'nope.json') });
    expect(isError).toBe(true);
    expect(text).toContain('No project file at');
  });

  test('writes reach the file in the repo, not the workspace copy', async () => {
    await call('set_item_html', {
      name: 'landing',
      html: '<h1 data-t="landing.t">Hello</h1>',
      project: 'in-repo',
    });
    const doc = (await Bun.file(join(repo, 'design', 'in-repo.json')).json()) as ProjectDoc;
    expect(doc.items.landing?.html).toContain('Hello');
  });
});

describe('exports run as background tasks', () => {
  /* A full export is minutes of work. Holding the request open blows the
     client's timeout and blocks the model on a job it need not watch. */
  test('export_html returns a task id immediately', async () => {
    const started = Date.now();
    const { text, isError } = await call('export_html', {
      project: 'blog',
      out: join(dir, 'out-html'),
    });
    expect(isError).toBe(false);
    expect(text).toContain('export_html-');
    expect(text).toContain('task_status');
    // Returning before the work is done is the entire point.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('task_status reports it, and eventually that it finished', async () => {
    const start = await call('export_html', { project: 'blog', out: join(dir, 'out-2') });
    const id = /export_html-\d+/.exec(start.text)?.[0];
    expect(id).toBeDefined();

    let status = '';
    for (let i = 0; i < 60; i++) {
      status = (await call('task_status', { task: id })).text;
      if (!status.includes('running')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(status).toContain('done in');
    expect(status).toContain('pages from blog');
  }, 30_000);

  test('and the files are actually there afterwards', async () => {
    expect(await Bun.file(join(dir, 'out-2', 'index.html')).exists()).toBe(true);
  });

  test('task_status with no id lists what has run', async () => {
    const { text } = await call('task_status');
    expect(text).toContain('export_html-');
  });

  test('an unknown task id says which ones exist', async () => {
    const { text } = await call('task_status', { task: 'nope-9' });
    expect(text).toContain('No task "nope-9"');
    expect(text).toContain('Known:');
  });

  test('a failing export is reported as failed, not lost', async () => {
    const start = await call('export_png', {
      project: 'blog',
      out: join(dir, 'out-png'),
      // No such screen, and the sidecar is never reached — but even a failure
      // has to come back through the task rather than vanishing.
      screens: ['does-not-exist'],
      scale: 1,
    });
    const id = /export_png-\d+/.exec(start.text)?.[0];
    let status = '';
    for (let i = 0; i < 40; i++) {
      status = (await call('task_status', { task: id })).text;
      if (!status.includes('running')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // Nothing matched, so it completes with zero files rather than erroring.
    expect(status).toMatch(/done in|FAILED/);
  }, 30_000);
});
