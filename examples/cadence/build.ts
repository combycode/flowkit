/* Cadence — the demo project, built through flowkit's own MCP tools.
 *
 * This is how the design in cadence.json was made: not by hand-editing JSON, but
 * by driving the real MCP server exactly as an agent would. It doubles as an
 * integration example and as provenance — re-run it and the project rebuilds.
 *
 *   bun run examples/cadence/build.ts <phase>
 *
 * Phases run in order and are idempotent enough to re-run: a call that fails
 * because something already exists is logged and skipped, so a phase can be
 * edited and replayed without wiping the project first.
 */

import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = import.meta.dir;
const PROJECT = 'cadence';

const client = new Client({ name: 'cadence-build', version: '0' });
await client.connect(
  new StdioClientTransport({
    command: 'bun',
    args: [
      'run',
      join(HERE, '..', '..', 'packages', 'mcp-server', 'src', 'main.ts'),
      '--workspace',
      HERE,
      '--no-studio',
    ],
  }),
);

let ok = 0;
let skipped = 0;

/** One tool call. Errors are reported and swallowed so a replay survives
 *  "already exists"; anything unexpected is printed loudly enough to see. */
async function call(tool: string, args: Record<string, unknown> = {}): Promise<string> {
  const r = (await client.callTool({
    name: tool,
    arguments: { project: PROJECT, ...args },
  })) as { content: { text?: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text ?? '').join('\n');
  if (r.isError) {
    skipped += 1;
    console.log(`  · ${tool}(${args.name ?? args.id ?? ''}) skipped: ${text.split('\n')[0]}`);
  } else {
    ok += 1;
  }
  return text;
}

// ── the phases ──────────────────────────────────────────────────────────────

/** Atomic elements, each owning its own CSS lifted from the house sheet. */
async function elements(): Promise<void> {
  // A button whose label is a slot, so every screen fills its own words.
  await call('create_item', {
    name: 'button',
    tier: 'element',
    html: '<button class="button"><x-slot/></button>',
    description: 'The primary action. Quiet and danger are variants.',
  });
  await call('set_variant', {
    name: 'button',
    variant: 'quiet',
    class: 'button--quiet',
    label: 'Quiet',
  });
  await call('set_variant', {
    name: 'button',
    variant: 'danger',
    class: 'button--danger',
    label: 'Danger',
  });
  await call('set_item_css', {
    name: 'button',
    css: `.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.button--quiet {
  background: transparent;
  border-color: var(--border-strong);
  color: var(--text);
}
.button--danger {
  background: var(--danger);
  color: var(--bg);
}`,
  });

  // A status pill: four states as CLASS variants (the html-variant case is
  // shown by nav-item's active state later).
  await call('create_item', {
    name: 'pill',
    tier: 'element',
    html: '<span class="pill"><x-slot/></span>',
    description: 'A task status. todo / doing / done / blocked.',
  });
  await call('set_item_css', {
    name: 'pill',
    css: `.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  background: var(--surface-2);
  color: var(--text-muted);
}
.pill::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.pill--todo { background: var(--surface-2); color: var(--text-muted); }
.pill--doing { background: var(--accent-soft); color: var(--accent); }
.pill--done { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.pill--blocked { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }`,
  });
  for (const state of ['todo', 'doing', 'done', 'blocked']) {
    await call('set_variant', { name: 'pill', variant: state, class: `pill--${state}`, label: state });
  }
  await call('set_item_meta', { name: 'pill', description: 'Task status. Default is todo.' });

  // An avatar: initials in a coloured disc.
  await call('create_item', {
    name: 'avatar',
    tier: 'element',
    html: '<span class="avatar"><x-slot/></span>',
    description: 'A person, as initials.',
  });
  await call('set_item_css', {
    name: 'avatar',
    css: `.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 700;
}`,
  });

  // A tag — a small count or label.
  await call('create_item', {
    name: 'tag',
    tier: 'element',
    html: '<span class="tag"><x-slot/></span>',
    description: 'A small count or label.',
  });
  await call('set_item_css', {
    name: 'tag',
    css: `.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 600;
}`,
  });
}

/** The icon sprite: one item holding every glyph as a <symbol>, hidden, and
 *  pulled into each layout so <use href="#i-…"> resolves. The kit foundation
 *  reads its symbols straight from here. */
async function sprite(): Promise<void> {
  const glyph = (id: string, body: string) =>
    `<symbol id="i-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`;
  const symbols = [
    glyph('home', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    glyph('board', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
    glyph('list', '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>'),
    glyph('settings', '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.4-2.5H9.6l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4.8l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z"/>'),
    glyph('plus', '<path d="M12 5v14M5 12h14"/>'),
    glyph('search', '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    glyph('check', '<path d="M20 6L9 17l-5-5"/>'),
    glyph('bell', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    glyph('user', '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    glyph('chevron', '<path d="M9 6l6 6-6 6"/>'),
  ].join('');

  await call('create_item', {
    name: 'sprite',
    tier: 'element',
    html: `<svg class="sprite" width="0" height="0" aria-hidden="true">${symbols}</svg>`,
    description: 'The icon sprite — every glyph, hidden, inlined by the layouts.',
  });
  await call('set_item_css', { name: 'sprite', css: '.sprite { position: absolute; width: 0; height: 0; }' });
}

/** The rest of the atoms. */
async function elements2(): Promise<void> {
  // One glyph from the sprite. flowkit has no attribute interpolation, so each
  // glyph is an html-variant that points <use> at its own symbol — which also
  // makes a tidy row of every icon on the kit's elements sheet.
  const glyphs = ['home', 'board', 'list', 'settings', 'plus', 'search', 'check', 'bell', 'user', 'chevron'];
  await call('create_item', {
    name: 'icon',
    tier: 'element',
    html: '<svg class="icon" aria-hidden="true"><use href="#i-home"/></svg>',
    description: 'One glyph from the sprite. Choose it with a variant (board, list, …).',
  });
  for (const g of glyphs) {
    await call('set_variant', {
      name: 'icon',
      variant: g,
      label: g,
      html: `<svg class="icon" aria-hidden="true"><use href="#i-${g}"/></svg>`,
    });
  }
  await call('set_item_css', {
    name: 'icon',
    css: `.icon {
  width: 20px;
  height: 20px;
  flex: none;
  color: currentColor;
}`,
  });

  await call('create_item', {
    name: 'input',
    tier: 'element',
    html: '<input class="input" type="text"/>',
    description: 'A text field.',
  });
  await call('set_item_css', {
    name: 'input',
    css: `.input {
  width: 100%;
  padding: var(--space-3);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.input:focus {
  border-color: var(--accent);
  outline: none;
}
.input::placeholder { color: var(--text-muted); }`,
  });

  await call('create_item', {
    name: 'checkbox',
    tier: 'element',
    html: '<span class="checkbox"></span>',
    description: 'A checkbox. Checked is a variant.',
  });
  await call('set_variant', { name: 'checkbox', variant: 'checked', class: 'checkbox--on', label: 'checked' });
  await call('set_item_css', {
    name: 'checkbox',
    css: `.checkbox {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: var(--border-width) solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.checkbox--on {
  border-color: var(--accent);
  background: var(--accent);
  position: relative;
}
.checkbox--on::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1px;
  width: 5px;
  height: 10px;
  border: solid var(--accent-text);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}`,
  });

  await call('create_item', {
    name: 'link',
    tier: 'element',
    html: '<a class="link" href="#"><x-slot/></a>',
    description: 'A text link.',
  });
  await call('set_item_css', {
    name: 'link',
    css: `.link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}
.link:hover { text-decoration: underline; }`,
  });
}

/** The parts a person recognises. */
async function components(): Promise<void> {
  // nav-item — the html-variant demo: the active state carries its own markup
  // (an accent bar) rather than only a class.
  await call('create_item', {
    name: 'nav-item',
    tier: 'component',
    html: '<a class="nav-item" href="#"><x-slot name="icon"/><x-slot/></a>',
    description: 'A sidebar link. Active is an html-variant with its own accent bar.',
  });
  await call('set_variant', {
    name: 'nav-item',
    variant: 'active',
    label: 'active',
    html: '<a class="nav-item nav-item--active" href="#"><span class="nav-item__bar"></span><x-slot name="icon"/><x-slot/></a>',
  });
  await call('set_item_css', {
    name: 'nav-item',
    css: `.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
}
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item--active { background: var(--accent-soft); color: var(--accent); }
.nav-item__bar {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--accent);
}
@media (max-width: 640px) {
  .nav-item { flex-direction: column; gap: 2px; padding: var(--space-2); font-size: var(--text-xs); align-items: center; justify-content: center; flex: 1; }
  .nav-item--active { background: transparent; }
  .nav-item__bar { display: none; }
}`,
  });

  await call('create_item', {
    name: 'task-card',
    tier: 'component',
    html: `<article class="task-card">
  <div class="task-card__row">
    <x-slot name="status"/>
    <x-slot name="assignee"/>
  </div>
  <h3 class="task-card__title"><x-slot name="title"/></h3>
  <p class="task-card__meta"><x-slot name="meta"/></p>
</article>`,
    description: 'A task on the board. Status pill, assignee, title, meta.',
  });
  await call('set_item_css', {
    name: 'task-card',
    css: `.task-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.task-card__row { display: flex; align-items: center; justify-content: space-between; }
.task-card__title { margin: 0; font-size: var(--text-md); }
.task-card__meta { margin: 0; color: var(--text-muted); font-size: var(--text-sm); }`,
  });

  await call('create_item', {
    name: 'stat-card',
    tier: 'component',
    html: `<article class="stat-card">
  <span class="stat-card__label"><x-slot name="label"/></span>
  <strong class="stat-card__value"><x-slot name="value"/></strong>
  <span class="stat-card__delta"><x-slot name="delta"/></span>
</article>`,
    description: 'A headline number on the dashboard.',
  });
  await call('set_item_css', {
    name: 'stat-card',
    css: `.stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.stat-card__label { color: var(--text-muted); font-size: var(--text-sm); }
.stat-card__value { font-size: var(--text-2xl); }
.stat-card__delta { color: var(--success); font-size: var(--text-xs); font-weight: 600; }`,
  });

  await call('create_item', {
    name: 'list-row',
    tier: 'component',
    html: `<div class="list-row">
  <span class="list-row__title"><x-slot name="title"/></span>
  <x-slot name="status"/>
  <x-slot name="assignee"/>
  <span class="list-row__when"><x-slot name="when"/></span>
</div>`,
    description: 'One row of the task table.',
  });
  await call('set_item_css', {
    name: 'list-row',
    css: `.list-row {
  display: grid;
  grid-template-columns: 1fr auto auto 7rem;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-width) solid var(--border);
}
.list-row__title { font-weight: 500; }
.list-row__when { color: var(--text-muted); font-size: var(--text-sm); text-align: right; }`,
  });

  await call('create_item', {
    name: 'member-row',
    tier: 'component',
    html: `<div class="member-row">
  <x-slot name="avatar"/>
  <div class="member-row__id">
    <strong><x-slot name="name"/></strong>
    <span class="member-row__email"><x-slot name="email"/></span>
  </div>
  <x-slot name="role"/>
</div>`,
    description: 'A teammate in settings.',
  });
  await call('set_item_css', {
    name: 'member-row',
    css: `.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: var(--border-width) solid var(--border);
}
.member-row__id { display: flex; flex-direction: column; margin-right: auto; }
.member-row__email { color: var(--text-muted); font-size: var(--text-sm); }`,
  });

  await call('create_item', {
    name: 'comment',
    tier: 'component',
    html: `<div class="comment">
  <x-slot name="avatar"/>
  <div class="comment__body">
    <div class="comment__head"><strong><x-slot name="who"/></strong><span class="comment__when"><x-slot name="when"/></span></div>
    <p class="comment__text"><x-slot name="text"/></p>
  </div>
</div>`,
    description: 'A comment on a task.',
  });
  await call('set_item_css', {
    name: 'comment',
    css: `.comment { display: flex; gap: var(--space-3); }
.comment__body { display: flex; flex-direction: column; gap: var(--space-1); }
.comment__head { display: flex; align-items: baseline; gap: var(--space-2); }
.comment__when { color: var(--text-muted); font-size: var(--text-xs); }
.comment__text { margin: 0; }`,
  });

  await call('create_item', {
    name: 'feature',
    tier: 'component',
    html: `<div class="feature">
  <div class="feature__icon"><x-slot name="icon"/></div>
  <h3 class="feature__title"><x-slot name="title"/></h3>
  <p class="feature__text"><x-slot name="text"/></p>
</div>`,
    description: 'One selling point on the landing page.',
  });
  await call('set_item_css', {
    name: 'feature',
    css: `.feature { display: flex; flex-direction: column; gap: var(--space-2); }
.feature__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent);
}
.feature__title { margin: 0; font-size: var(--text-lg); }
.feature__text { margin: 0; color: var(--text-muted); }`,
  });

  await call('create_item', {
    name: 'tier',
    tier: 'component',
    html: `<article class="tier">
  <header class="tier__head"><h3 class="tier__name"><x-slot name="name"/></h3><div class="tier__price"><x-slot name="price"/></div></header>
  <ul class="tier__feats"><x-slot name="feats"/></ul>
  <x-slot name="cta"/>
</article>`,
    description: 'A pricing plan. Featured is a variant.',
  });
  await call('set_variant', { name: 'tier', variant: 'featured', class: 'tier--featured', label: 'featured' });
  await call('set_item_css', {
    name: 'tier',
    css: `.tier {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.tier--featured { border-color: var(--accent); box-shadow: var(--shadow); }
.tier__head { display: flex; flex-direction: column; gap: var(--space-1); }
.tier__name { margin: 0; font-size: var(--text-lg); }
.tier__price { font-size: var(--text-2xl); font-weight: 700; }
.tier__feats { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); color: var(--text-muted); }`,
  });
}

/** What holds the parts and places itself on the page. */
async function containers(): Promise<void> {
  // The sidebar — the container our kit page draws per-variant at its designed
  // viewport. mini is the collapsed rail.
  await call('create_item', {
    name: 'sidebar',
    tier: 'container',
    html: `<aside class="sidebar">
  <div class="sidebar__brand"><x-icon variant="board"/><span class="sidebar__name" data-t="brand.name">Cadence</span></div>
  <nav class="sidebar__nav"><x-slot/></nav>
  <div class="sidebar__foot"><x-slot name="foot"/></div>
</aside>`,
    description: 'The app rail. Expanded by default; mini is the collapsed variant.',
  });
  await call('set_item_meta', { name: 'sidebar', viewport: 'desktop' });
  await call('set_variant', { name: 'sidebar', variant: 'mini', class: 'sidebar--mini', label: 'mini' });
  await call('set_item_css', {
    name: 'sidebar',
    css: `.sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: 232px;
  flex: none;
  padding: var(--space-5) var(--space-4);
  border-right: var(--border-width) solid var(--border);
  background: var(--surface);
}
.sidebar__brand { display: flex; align-items: center; gap: var(--space-2); font-weight: 700; color: var(--text); }
.sidebar__brand .icon { color: var(--accent); }
.sidebar__nav { display: flex; flex-direction: column; gap: var(--space-1); }
.sidebar__foot { margin-top: auto; }
.sidebar--mini { width: 64px; align-items: center; }
.sidebar--mini .sidebar__name { display: none; }
@media (max-width: 640px) {
  .sidebar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50; flex-direction: row; width: auto; gap: 0; padding: var(--space-1) var(--space-2); border-right: none; border-top: var(--border-width) solid var(--border); }
  .sidebar__brand, .sidebar__foot { display: none; }
  .sidebar__nav { flex-direction: row; flex: 1; gap: var(--space-1); justify-content: space-around; }
}`,
  });

  // The top bar of the app.
  await call('create_item', {
    name: 'topbar',
    tier: 'container',
    html: `<header class="topbar">
  <div class="topbar__title"><x-slot name="title"/></div>
  <div class="topbar__actions"><x-slot name="actions"/></div>
</header>`,
    description: 'The app header: page title on the left, actions on the right.',
  });
  await call('set_item_meta', { name: 'topbar', viewport: 'desktop' });
  await call('set_item_css', {
    name: 'topbar',
    css: `.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--border);
  background: var(--surface);
}
.topbar__title { font-size: var(--text-lg); font-weight: 600; }
.topbar__actions { display: flex; align-items: center; gap: var(--space-3); }
@media (max-width: 640px) {
  .topbar { padding: var(--space-3) var(--space-4); gap: var(--space-3); }
  .topbar__title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .topbar__actions { gap: var(--space-2); flex: none; }
}`,
  });

  // A kanban column.
  await call('create_item', {
    name: 'board-column',
    tier: 'container',
    html: `<section class="board-col">
  <header class="board-col__head"><x-slot name="name"/><x-slot name="count"/></header>
  <div class="board-col__body"><x-slot/></div>
</section>`,
    description: 'One column of the board.',
  });
  await call('set_item_css', {
    name: 'board-column',
    css: `.board-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 288px;
  flex: none;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.board-col__head { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-2); font-weight: 600; }
.board-col__body { display: flex; flex-direction: column; gap: var(--space-3); }`,
  });

  // A modal, over a scrim.
  await call('create_item', {
    name: 'modal',
    tier: 'container',
    html: `<div class="modal-scrim">
  <div class="modal">
    <header class="modal__head"><h2 class="modal__title"><x-slot name="title"/></h2></header>
    <div class="modal__body"><x-slot/></div>
    <footer class="modal__foot"><x-slot name="actions"/></footer>
  </div>
</div>`,
    description: 'A dialog over a dimmed page.',
  });
  await call('set_item_meta', { name: 'modal', viewport: 'desktop' });
  await call('set_item_css', {
    name: 'modal',
    css: `.modal-scrim {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: var(--scrim);
}
.modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  max-width: 480px;
  padding: var(--space-5);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.modal__head { display: flex; align-items: center; justify-content: space-between; }
.modal__title { margin: 0; font-size: var(--text-lg); }
.modal__body { display: flex; flex-direction: column; gap: var(--space-3); }
.modal__foot { display: flex; justify-content: flex-end; gap: var(--space-2); }`,
  });
}

/** The shells a screen is poured into. Screens compose these as components. */
async function layouts(): Promise<void> {
  await call('create_item', {
    name: 'app-shell',
    tier: 'layout',
    html: `<div class="app">
  <x-sprite/>
  <x-slot name="sidebar"/>
  <div class="app__main">
    <x-slot name="topbar"/>
    <main class="app__content"><x-slot name="content"/></main>
  </div>
</div>`,
    description: 'The signed-in shell: sidebar + main column with a top bar.',
  });
  await call('set_item_meta', { name: 'app-shell', viewport: 'desktop' });
  await call('set_item_css', {
    name: 'app-shell',
    css: `.app { display: flex; min-height: 100vh; background: var(--bg); color: var(--text); }
.app__main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.app__content { flex: 1; padding: var(--space-6) var(--space-5); display: flex; flex-direction: column; gap: var(--space-5); }
@media (max-width: 640px) {
  .app { flex-direction: column; }
  .app__content { padding: var(--space-4); padding-bottom: 76px; gap: var(--space-4); }
}`,
  });

  await call('create_item', {
    name: 'marketing-shell',
    tier: 'layout',
    html: `<div class="marketing">
  <x-sprite/>
  <header class="mkt-nav">
    <div class="mkt-nav__brand"><x-icon variant="board"/><span data-t="brand.name">Cadence</span></div>
    <nav class="mkt-nav__links"><x-slot name="nav"/></nav>
  </header>
  <main class="mkt-main"><x-slot name="content"/></main>
  <footer class="mkt-foot"><x-slot name="footer"/></footer>
</div>`,
    description: 'The public shell: top nav, content, footer.',
  });
  await call('set_item_meta', { name: 'marketing-shell', viewport: 'desktop' });
  await call('set_item_css', {
    name: 'marketing-shell',
    css: `.marketing { min-height: 100vh; background: var(--bg); color: var(--text); }
.mkt-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-4) var(--space-6); border-bottom: var(--border-width) solid var(--border); }
.mkt-nav__brand { display: flex; align-items: center; gap: var(--space-2); font-weight: 700; }
.mkt-nav__brand .icon { color: var(--accent); }
.mkt-nav__links { display: flex; align-items: center; gap: var(--space-4); }
.mkt-main { max-width: 1080px; margin: 0 auto; padding: var(--space-7) var(--space-6); display: flex; flex-direction: column; gap: var(--space-7); }
.mkt-foot { padding: var(--space-6); border-top: var(--border-width) solid var(--border); color: var(--text-muted); text-align: center; }
@media (max-width: 640px) {
  .mkt-nav { padding: var(--space-3) var(--space-4); gap: var(--space-2); }
  .mkt-nav__links { gap: var(--space-3); }
  .mkt-main { padding: var(--space-6) var(--space-4); gap: var(--space-6); }
}`,
  });

  await call('create_item', {
    name: 'auth-shell',
    tier: 'layout',
    html: `<div class="auth">
  <x-sprite/>
  <div class="auth__card"><x-slot name="content"/></div>
</div>`,
    description: 'The centred shell for sign-in and sign-up.',
  });
  await call('set_item_css', {
    name: 'auth-shell',
    css: `.auth { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--space-5); background: var(--bg); color: var(--text); }
.auth__card { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-6); border: var(--border-width) solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }`,
  });
}

/** Create a screen (or leave it be if it exists), set its markup, and give it
 *  the house sheet so its layout primitives (.stack, .row, .field) are drawn. */
async function screen(name: string, html: string, description: string): Promise<void> {
  await call('create_item', { name, tier: 'screen', html, description });
  await call('set_item_html', { name, html });
  // ui = the house primitives (.stack/.row/.field); pages = section layouts
  // (.hero/.features/.tiers) that belong to no single item.
  await call('update_item_sheets', { name, sheets: ['ui', 'pages'] });
}

/** Remove the starter screens Cadence does not reuse, and their nodes. */
async function cleanup(): Promise<void> {
  for (const id of ['home', 'detail', 'sign-in-failed']) {
    await call('delete_node', { id });
    await call('delete_item', { name: id });
  }
}

/** Section layouts shared by the screens — the parts that belong to a page
 *  rather than to any one registry item. */
async function pagesSheet(): Promise<void> {
  await call('set_sheet', {
    name: 'pages',
    css: `.hero { display: flex; flex-direction: column; gap: var(--space-4); align-items: flex-start; padding: var(--space-6) 0; }
.hero__title { margin: 0; font-size: var(--text-2xl); max-width: 20ch; line-height: var(--leading-tight); }
.hero__sub { margin: 0; color: var(--text-muted); font-size: var(--text-lg); max-width: 52ch; }
.hero__cta { display: flex; gap: var(--space-3); }
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-5); }
.tiers { display: grid; grid-template-columns: repeat(2, minmax(0, 320px)); gap: var(--space-5); }
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); }
.board { display: flex; gap: var(--space-4); align-items: stretch; overflow-x: auto; flex: 1; min-height: 0; }
.table { display: flex; flex-direction: column; border: var(--border-width) solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.table__head { display: grid; grid-template-columns: 1fr auto auto 7rem; gap: var(--space-4); padding: var(--space-3) var(--space-4); background: var(--surface-2); color: var(--text-muted); font-size: var(--text-sm); }
.detail { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-5); align-items: start; }
.panel { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: var(--border-width) solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.section-title { font-size: var(--text-lg); font-weight: 600; }
@media (max-width: 640px) {
  .features { grid-template-columns: 1fr; }
  .tiers { grid-template-columns: 1fr; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .detail { grid-template-columns: 1fr; }
  .hero__title, .hero__sub { max-width: none; }
}`,
  });

  // The base stylesheet: the default reset PLUS a themed window scrollbar, so
  // every screen replaces the OS default scrollbar with a thin, on-brand one.
  await call('set_base', {
    css: `*,
*::before,
*::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: var(--text-md); line-height: var(--leading-body); -webkit-font-smoothing: antialiased; }
h1, h2, h3, p, figure { margin: 0; }
h1 { font-size: var(--text-2xl); line-height: var(--leading-tight); letter-spacing: -0.01em; }
h2 { font-size: var(--text-xl); line-height: var(--leading-tight); }
a { color: var(--accent); }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Themed window scrollbar — replaces the OS default on every screen. */
* { scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: var(--radius-pill); border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
::-webkit-scrollbar-corner { background: transparent; }`,
  });
}

/** Auth and marketing — the public face, on the auth and marketing shells. */
async function screensA(): Promise<void> {
  await pagesSheet();
  await screen(
    'sign-in',
    `<x-auth-shell>
  <x-fill slot="content">
    <div class="stack">
      <h1 data-t="signin.title">Sign in to Cadence</h1>
      <div class="field"><label data-t="signin.email">Email</label><x-input/></div>
      <div class="field"><label data-t="signin.password">Password</label><x-input/></div>
      <x-button><span data-t="signin.submit">Sign in</span></x-button>
      <p class="muted"><span data-t="signin.alt">New here?</span> <x-link><span data-t="signin.signup">Create an account</span></x-link></p>
    </div>
  </x-fill>
</x-auth-shell>`,
    'Signing in.',
  );

  await screen(
    'sign-up',
    `<x-auth-shell>
  <x-fill slot="content">
    <div class="stack">
      <h1 data-t="signup.title">Create your workspace</h1>
      <div class="field"><label data-t="signup.name">Your name</label><x-input/></div>
      <div class="field"><label data-t="signup.email">Work email</label><x-input/></div>
      <div class="field"><label data-t="signup.password">Password</label><x-input/></div>
      <x-button><span data-t="signup.submit">Create account</span></x-button>
      <p class="muted"><span data-t="signup.alt">Already have one?</span> <x-link><span data-t="signup.signin">Sign in</span></x-link></p>
    </div>
  </x-fill>
</x-auth-shell>`,
    'Creating an account.',
  );

  await screen(
    'landing',
    `<x-marketing-shell>
  <x-fill slot="nav">
    <x-link><span data-t="nav.features">Features</span></x-link>
    <x-link><span data-t="nav.pricing">Pricing</span></x-link>
    <x-button variant="quiet"><span data-t="nav.signin">Sign in</span></x-button>
  </x-fill>
  <x-fill slot="content">
    <section class="hero">
      <h1 class="hero__title" data-t="landing.title">Ship work in a rhythm your team can keep.</h1>
      <p class="hero__sub" data-t="landing.sub">Cadence is a calm place to plan, track and finish work — boards, lists and just enough structure.</p>
      <div class="hero__cta">
        <x-button><span data-t="landing.start">Start free</span></x-button>
        <x-button variant="quiet"><span data-t="landing.tour">Take the tour</span></x-button>
      </div>
    </section>
    <section class="features">
      <x-feature><x-fill slot="icon"><x-icon variant="board"/></x-fill><x-fill slot="title"><span data-t="landing.f1-title">Boards that stay tidy</span></x-fill><x-fill slot="text"><span data-t="landing.f1-text">Drag work across columns. Cadence keeps the noise down.</span></x-fill></x-feature>
      <x-feature><x-fill slot="icon"><x-icon variant="list"/></x-fill><x-fill slot="title"><span data-t="landing.f2-title">Lists when you need them</span></x-fill><x-fill slot="text"><span data-t="landing.f2-text">The same work as a sortable table, a click away.</span></x-fill></x-feature>
      <x-feature><x-fill slot="icon"><x-icon variant="bell"/></x-fill><x-fill slot="title"><span data-t="landing.f3-title">Gentle nudges</span></x-fill><x-fill slot="text"><span data-t="landing.f3-text">Reminders that respect your focus, not interrupt it.</span></x-fill></x-feature>
    </section>
  </x-fill>
  <x-fill slot="footer"><span data-t="landing.foot">Cadence — a demo built with flowkit.</span></x-fill>
</x-marketing-shell>`,
    'The landing page.',
  );

  await screen(
    'pricing',
    `<x-marketing-shell>
  <x-fill slot="nav">
    <x-link><span data-t="nav.features">Features</span></x-link>
    <x-link><span data-t="nav.pricing">Pricing</span></x-link>
    <x-button variant="quiet"><span data-t="nav.signin">Sign in</span></x-button>
  </x-fill>
  <x-fill slot="content">
    <section class="stack">
      <h1 data-t="pricing.title">Simple pricing</h1>
      <p class="muted" data-t="pricing.sub">Start free. Grow when you are ready.</p>
    </section>
    <section class="tiers">
      <x-tier>
        <x-fill slot="name"><span data-t="pricing.free">Free</span></x-fill>
        <x-fill slot="price"><span data-t="pricing.free-price">$0</span></x-fill>
        <x-fill slot="feats"><li data-t="pricing.free-1">Up to 3 projects</li><li data-t="pricing.free-2">Board and list views</li></x-fill>
        <x-fill slot="cta"><x-button variant="quiet"><span data-t="pricing.free-cta">Start free</span></x-button></x-fill>
      </x-tier>
      <x-tier variant="featured">
        <x-fill slot="name"><span data-t="pricing.team">Team</span></x-fill>
        <x-fill slot="price"><span data-t="pricing.team-price">$8</span></x-fill>
        <x-fill slot="feats"><li data-t="pricing.team-1">Unlimited projects</li><li data-t="pricing.team-2">Members and roles</li><li data-t="pricing.team-3">Reminders</li></x-fill>
        <x-fill slot="cta"><x-button><span data-t="pricing.team-cta">Start Team</span></x-button></x-fill>
      </x-tier>
    </section>
  </x-fill>
  <x-fill slot="footer"><span data-t="landing.foot">Cadence — a demo built with flowkit.</span></x-fill>
</x-marketing-shell>`,
    'The pricing page.',
  );
}

/* ── the app screens ─────────────────────────────────────────────────────── */

/** One sidebar nav row: an icon, a shared label key, and the active bar on the
 *  current page (an html-variant). */
const navItem = (page: string, glyph: string, label: string, active: boolean): string =>
  `<x-nav-item${active ? ' variant="active"' : ''}><x-fill slot="icon"><x-icon variant="${glyph}"/></x-fill><span data-t="nav.${page}">${label}</span></x-nav-item>`;

/** The rail, with the current page marked. Labels are SHARED keys (nav.*), so
 *  they are translated once, not per screen. */
const sidebar = (active: string): string =>
  `<x-sidebar>
      ${navItem('dashboard', 'home', 'Dashboard', active === 'dashboard')}
      ${navItem('board', 'board', 'Board', active === 'board')}
      ${navItem('list', 'list', 'List', active === 'list')}
      <x-fill slot="foot">${navItem('settings', 'settings', 'Settings', active === 'settings')}</x-fill>
    </x-sidebar>`;

/** Wrap text that is passed into a component slot. A data-t must ride on a real
 *  element, and the composer strips `<x-fill>` — so bare slot text cannot be
 *  keyed or translated. A <span> around it survives composition and is what
 *  extract_strings then stamps. */
const w = (s: string): string => `<span>${s}</span>`;

/** The signed-in frame around a screen's own content. `title` is already markup
 *  (a keyed span), so a page can reuse a nav key or bring its own. */
const appScreen = (active: string, title: string, content: string): string =>
  `<x-app-shell>
  <x-fill slot="sidebar">${sidebar(active)}</x-fill>
  <x-fill slot="topbar"><x-topbar>
    <x-fill slot="title">${title}</x-fill>
    <x-fill slot="actions"><x-icon variant="search"/><x-icon variant="bell"/><x-button><x-icon variant="plus"/><span data-t="action.new">New task</span></x-button></x-fill>
  </x-topbar></x-fill>
  <x-fill slot="content">${content}</x-fill>
</x-app-shell>`;

const task = (status: string, statusLabel: string, who: string, title: string, meta: string): string =>
  `<x-task-card><x-fill slot="status"><x-pill variant="${status}">${w(statusLabel)}</x-pill></x-fill><x-fill slot="assignee"><x-avatar>${w(who)}</x-avatar></x-fill><x-fill slot="title">${w(title)}</x-fill><x-fill slot="meta">${w(meta)}</x-fill></x-task-card>`;

async function screensB(): Promise<void> {
  // Dashboard — headline numbers, then the viewer's own tasks.
  await screen(
    'dashboard',
    appScreen(
      'dashboard',
      '<span data-t="nav.dashboard">Dashboard</span>',
      `<section class="stat-grid">
      <x-stat-card><x-fill slot="label">${w('Open')}</x-fill><x-fill slot="value">${w('12')}</x-fill><x-fill slot="delta">${w('+3 this week')}</x-fill></x-stat-card>
      <x-stat-card><x-fill slot="label">${w('In progress')}</x-fill><x-fill slot="value">${w('5')}</x-fill><x-fill slot="delta">${w('+1 this week')}</x-fill></x-stat-card>
      <x-stat-card><x-fill slot="label">${w('Done')}</x-fill><x-fill slot="value">${w('28')}</x-fill><x-fill slot="delta">${w('+9 this week')}</x-fill></x-stat-card>
      <x-stat-card><x-fill slot="label">${w('Blocked')}</x-fill><x-fill slot="value">${w('2')}</x-fill><x-fill slot="delta">${w('no change')}</x-fill></x-stat-card>
    </section>
    <div class="section-title">Your tasks</div>
    <div class="stack">
      ${task('doing', 'In progress', 'AM', 'Wire up the board view', 'Due Friday · Web')}
      ${task('todo', 'To do', 'JS', 'Draft the pricing page copy', 'Due Monday · Marketing')}
      ${task('blocked', 'Blocked', 'RK', 'Migrate the auth service', 'Waiting on review · Platform')}
    </div>`,
    ),
    'The signed-in home: a few numbers and your work.',
  );

  // Board — three columns of cards.
  await screen(
    'board',
    appScreen(
      'board',
      '<span data-t="nav.board">Board</span>',
      `<div class="board">
      <x-board-column><x-fill slot="name">${w('To do')}</x-fill><x-fill slot="count"><x-tag>${w('3')}</x-tag></x-fill>
        ${task('todo', 'To do', 'JS', 'Draft the pricing page copy', 'Marketing')}
        ${task('todo', 'To do', 'AM', 'Add empty states', 'Web')}
        ${task('todo', 'To do', 'RK', 'Write onboarding email', 'Growth')}
      </x-board-column>
      <x-board-column><x-fill slot="name">${w('Doing')}</x-fill><x-fill slot="count"><x-tag>${w('2')}</x-tag></x-fill>
        ${task('doing', 'In progress', 'AM', 'Wire up the board view', 'Web')}
        ${task('doing', 'In progress', 'JS', 'Design the settings page', 'Web')}
      </x-board-column>
      <x-board-column><x-fill slot="name">${w('Done')}</x-fill><x-fill slot="count"><x-tag>${w('2')}</x-tag></x-fill>
        ${task('done', 'Done', 'RK', 'Set up the design tokens', 'Web')}
        ${task('done', 'Done', 'AM', 'Ship the landing page', 'Marketing')}
      </x-board-column>
    </div>`,
    ),
    'The kanban board.',
  );

  // List — the same work as a table.
  await screen(
    'list',
    appScreen(
      'list',
      '<span data-t="nav.list">List</span>',
      `<div class="table">
      <div class="table__head"><span>Task</span><span>Status</span><span>Owner</span><span>Updated</span></div>
      <x-list-row><x-fill slot="title">${w('Wire up the board view')}</x-fill><x-fill slot="status"><x-pill variant="doing">${w('In progress')}</x-pill></x-fill><x-fill slot="assignee"><x-avatar>${w('AM')}</x-avatar></x-fill><x-fill slot="when">${w('2d ago')}</x-fill></x-list-row>
      <x-list-row><x-fill slot="title">${w('Draft the pricing page copy')}</x-fill><x-fill slot="status"><x-pill variant="todo">${w('To do')}</x-pill></x-fill><x-fill slot="assignee"><x-avatar>${w('JS')}</x-avatar></x-fill><x-fill slot="when">${w('4h ago')}</x-fill></x-list-row>
      <x-list-row><x-fill slot="title">${w('Migrate the auth service')}</x-fill><x-fill slot="status"><x-pill variant="blocked">${w('Blocked')}</x-pill></x-fill><x-fill slot="assignee"><x-avatar>${w('RK')}</x-avatar></x-fill><x-fill slot="when">${w('1d ago')}</x-fill></x-list-row>
      <x-list-row><x-fill slot="title">${w('Set up the design tokens')}</x-fill><x-fill slot="status"><x-pill variant="done">${w('Done')}</x-pill></x-fill><x-fill slot="assignee"><x-avatar>${w('RK')}</x-avatar></x-fill><x-fill slot="when">${w('3d ago')}</x-fill></x-list-row>
    </div>`,
    ),
    'The list view — the same work as a table.',
  );

  // Task detail — the thing, opened, with a side panel and comments.
  await screen(
    'task-detail',
    appScreen(
      'board',
      w('Wire up the board view'),
      `<div class="detail">
      <div class="stack">
        <h1>Wire up the board view</h1>
        <p class="muted">Cards should drag between columns and keep their order. Start with the three default columns and the card component that already exists in the kit.</p>
        <div class="section-title">Comments</div>
        <x-comment><x-fill slot="avatar"><x-avatar>${w('JS')}</x-avatar></x-fill><x-fill slot="who">${w('Jordan')}</x-fill><x-fill slot="when">${w('yesterday')}</x-fill><x-fill slot="text">${w("Let's reuse the task-card as-is so the board and the list stay in sync.")}</x-fill></x-comment>
        <x-comment><x-fill slot="avatar"><x-avatar>${w('AM')}</x-avatar></x-fill><x-fill slot="who">${w('Alex')}</x-fill><x-fill slot="when">${w('3h ago')}</x-fill><x-fill slot="text">${w("Agreed. I'll wire the columns first and leave dragging for a follow-up.")}</x-fill></x-comment>
      </div>
      <div class="panel">
        <div class="row"><span class="muted">Status</span><x-pill variant="doing">${w('In progress')}</x-pill></div>
        <div class="row"><span class="muted">Assignee</span><x-avatar>${w('AM')}</x-avatar></div>
        <div class="row"><span class="muted">Due</span><span>Friday</span></div>
        <div class="row"><span class="muted">Project</span><x-tag>${w('Web')}</x-tag></div>
      </div>
    </div>`,
    ),
    'One task, opened.',
  );

  // Settings — a profile form and the team.
  await screen(
    'settings',
    appScreen(
      'settings',
      '<span data-t="nav.settings">Settings</span>',
      `<div class="detail">
      <div class="stack">
        <div class="section-title">Profile</div>
        <div class="field"><label>Name</label><x-input/></div>
        <div class="field"><label>Work email</label><x-input/></div>
        <div><x-button>${w('Save changes')}</x-button></div>
      </div>
      <div class="panel">
        <div class="section-title">Members</div>
        <x-member-row><x-fill slot="avatar"><x-avatar>${w('AM')}</x-avatar></x-fill><x-fill slot="name">${w('Alex Morgan')}</x-fill><x-fill slot="email">${w('alex@cadence.app')}</x-fill><x-fill slot="role"><x-tag>${w('Owner')}</x-tag></x-fill></x-member-row>
        <x-member-row><x-fill slot="avatar"><x-avatar>${w('JS')}</x-avatar></x-fill><x-fill slot="name">${w('Jordan Silva')}</x-fill><x-fill slot="email">${w('jordan@cadence.app')}</x-fill><x-fill slot="role"><x-tag>${w('Admin')}</x-tag></x-fill></x-member-row>
        <x-member-row><x-fill slot="avatar"><x-avatar>${w('RK')}</x-avatar></x-fill><x-fill slot="name">${w('Riya Kapoor')}</x-fill><x-fill slot="email">${w('riya@cadence.app')}</x-fill><x-fill slot="role"><x-tag>${w('Member')}</x-tag></x-fill></x-member-row>
      </div>
    </div>`,
    ),
    'Profile and team settings.',
  );
}

/** Trim the starter's house sheet down to the layout primitives the screens
 *  still use — button, tag, card, notice are registry items now, so their rules
 *  no longer belong in a shared sheet nobody can see the shape of. */
async function trim(): Promise<void> {
  await call('set_sheet', {
    name: 'ui',
    css: `.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field > label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}`,
  });
}

/** Put the screens on the canvas as a flow: two groups, and the paths a person
 *  takes from the landing page into the app. */
async function flow(): Promise<void> {
  await call('set_flow', { id: 'marketing', label: 'Marketing & auth' });
  await call('set_flow', { id: 'app', label: 'The app' });

  await call('add_node', { screen: 'landing', id: 'landing', group: 'marketing', title: 'Landing' });
  await call('add_node', { screen: 'pricing', id: 'pricing', group: 'marketing', title: 'Pricing' });
  await call('add_node', { screen: 'sign-up', id: 'sign-up', group: 'marketing', title: 'Sign up' });
  // sign-in came from the starter in 'main'; move it in with the rest.
  await call('update_node', { id: 'sign-in', groups: ['marketing'] });

  await call('add_node', { screen: 'dashboard', id: 'dashboard', group: 'app', title: 'Dashboard' });
  await call('add_node', { screen: 'board', id: 'board', group: 'app', title: 'Board' });
  await call('add_node', { screen: 'list', id: 'list', group: 'app', title: 'List' });
  await call('add_node', { screen: 'task-detail', id: 'task-detail', group: 'app', title: 'Task detail' });
  await call('add_node', { screen: 'settings', id: 'settings', group: 'app', title: 'Settings' });

  await call('connect', { from: 'landing', to: 'sign-up', label: 'Start free' });
  await call('connect', { from: 'landing', to: 'pricing', label: 'Pricing' });
  await call('connect', { from: 'landing', to: 'sign-in', label: 'Sign in' });
  await call('connect', { from: 'sign-up', to: 'dashboard', label: 'Create account' });
  await call('connect', { from: 'sign-in', to: 'dashboard', label: 'Signed in' });
  await call('connect', { from: 'dashboard', to: 'board', label: 'Board' });
  await call('connect', { from: 'dashboard', to: 'list', label: 'List' });
  await call('connect', { from: 'dashboard', to: 'settings', label: 'Settings' });
  await call('connect', { from: 'board', to: 'task-detail', label: 'Open a task' });
  await call('connect', { from: 'list', to: 'task-detail', label: 'Open a task' });

  await call('rearrange', { group: 'marketing' });
  await call('rearrange', { group: 'app' });
}

/** Give every screen its string entries — extract keys the plain content and
 *  backfills the hand-authored nav/brand keys. */
async function strings(): Promise<void> {
  for (const s of ['sign-in', 'sign-up', 'landing', 'pricing', 'dashboard', 'board', 'list', 'task-detail', 'settings']) {
    await call('extract_strings', { name: s });
  }
}

/** A second locale. The public pages and the app's chrome are translated in
 *  full — the convincing part of a locale switch — while sample task data falls
 *  back to the source language, as user-entered content would in a real app. */
async function locale(): Promise<void> {
  await call('add_locale', { id: 'es', label: 'Español' });
  await call('set_strings', {
    locale: 'es',
    entries: {
      'brand.name': 'Cadence',
      'action.new': 'Nueva tarea',
      'nav.dashboard': 'Panel',
      'nav.board': 'Tablero',
      'nav.list': 'Lista',
      'nav.settings': 'Ajustes',
      'nav.features': 'Características',
      'nav.pricing': 'Precios',
      'nav.signin': 'Iniciar sesión',
      'signin.title': 'Inicia sesión en Cadence',
      'signin.email': 'Correo electrónico',
      'signin.password': 'Contraseña',
      'signin.submit': 'Iniciar sesión',
      'signin.alt': '¿Nuevo por aquí?',
      'signin.signup': 'Crea una cuenta',
      'signup.title': 'Crea tu espacio de trabajo',
      'signup.name': 'Tu nombre',
      'signup.email': 'Correo del trabajo',
      'signup.password': 'Contraseña',
      'signup.submit': 'Crear cuenta',
      'signup.alt': '¿Ya tienes una?',
      'signup.signin': 'Inicia sesión',
      'landing.title': 'Trabaja a un ritmo que tu equipo pueda mantener.',
      'landing.sub':
        'Cadence es un lugar tranquilo para planificar, seguir y terminar el trabajo: tableros, listas y la estructura justa.',
      'landing.start': 'Empieza gratis',
      'landing.tour': 'Ver el tour',
      'landing.f1-title': 'Tableros que se mantienen ordenados',
      'landing.f1-text': 'Arrastra el trabajo entre columnas. Cadence mantiene el ruido a raya.',
      'landing.f2-title': 'Listas cuando las necesitas',
      'landing.f2-text': 'El mismo trabajo como una tabla ordenable, a un clic.',
      'landing.f3-title': 'Avisos discretos',
      'landing.f3-text': 'Recordatorios que respetan tu concentración, no la interrumpen.',
      'landing.foot': 'Cadence — una demo hecha con flowkit.',
      'pricing.title': 'Precios sencillos',
      'pricing.sub': 'Empieza gratis. Crece cuando estés listo.',
      'pricing.free': 'Gratis',
      'pricing.free-price': '$0',
      'pricing.free-1': 'Hasta 3 proyectos',
      'pricing.free-2': 'Vistas de tablero y lista',
      'pricing.free-cta': 'Empieza gratis',
      'pricing.team': 'Equipo',
      'pricing.team-price': '$8',
      'pricing.team-1': 'Proyectos ilimitados',
      'pricing.team-2': 'Miembros y roles',
      'pricing.team-3': 'Recordatorios',
      'pricing.team-cta': 'Empieza Equipo',
    },
  });
}

/** Tokens and strings the registry leans on beyond the starter kit. */
async function foundation(): Promise<void> {
  // A scrim colour, so the modal does not hardcode rgba() and the theme
  // switcher can move it.
  await call('set_token', { theme: 'dark', token: '--scrim', value: 'rgba(6, 8, 12, 0.6)' });
  await call('set_token', { theme: 'light', token: '--scrim', value: 'rgba(15, 18, 26, 0.35)' });
  // The brand name carries a key like any visible string, even though it reads
  // the same in every locale.
  await call('set_strings', { locale: 'en', entries: { 'brand.name': 'Cadence' } });
}

// ── run the requested phase ───────────────────────────────────────────────────

const phase = process.argv[2] ?? 'all';
const phases: Record<string, () => Promise<void>> = {
  foundation,
  elements,
  sprite,
  elements2,
  components,
  containers,
  layouts,
  cleanup,
  screensA,
  screensB,
  trim,
  flow,
  strings,
  locale,
};

/** A clean, ordered rebuild — the sequence a fresh project is built in. */
async function all(): Promise<void> {
  for (const [name, fn] of Object.entries(phases)) {
    console.log(`\n— ${name} —`);
    await fn();
  }
}

const run = phase === 'all' ? all : phases[phase];
if (!run) {
  console.error(`unknown phase "${phase}". known: all, ${Object.keys(phases).join(', ')}`);
} else {
  console.log(`building phase: ${phase}`);
  await run();
  console.log(`\n${phase}: ${ok} ok, ${skipped} skipped`);
}

await client.close();
