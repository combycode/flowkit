/* What a new project starts as.
 *
 * An empty document is not a starting point, it is a blank page with a
 * contract attached: before anything renders at all, someone has to invent a
 * palette, a type scale, a reset, and a house style for a button. A model
 * asked to "design a checkout flow" will do exactly that, differently every
 * time, and the result is a project whose screens do not agree with each
 * other by the second one.
 *
 * So a project starts with a small, complete design system and three screens
 * that use it. The screens matter as much as the tokens: they are the worked
 * example. They show that text carries a `data-t` key, that a screen names the
 * sheets it needs, that a flow branches — and a model extends an example far
 * more reliably than it invents a convention.
 *
 * Deliberately small. Everything here is meant to be replaced; it is a first
 * draft that renders, not a framework. What it must not be is arbitrary — the
 * tokens are a coherent scale, so a screen built from them looks considered
 * before anyone has chosen a colour.
 *
 * No webfonts. A font would have to be embedded as bytes, and a starter that
 * adds half a megabyte to every new project to avoid a system stack is a poor
 * trade. `--font-sans` is the one thing here most obviously meant to change.
 */

import type { Flow, Item, ItemName, Kit, Locale, Theme } from '../types/project';

export interface StarterContent {
  kit: Kit;
  items: Record<ItemName, Item>;
  flow: Flow;
  locales: Record<string, Locale>;
}

/* ── tokens ─────────────────────────────────────────────────────────────── */

/** Everything that is not a colour. Identical in every theme — the schema
 *  wants each theme to carry a COMPLETE map so that "a token missing from one
 *  theme" is a checkable condition rather than a bug someone finds in a
 *  screenshot, and that is worth more than avoiding the repetition. */
const SHAPE: Record<string, string> = {
  '--font-sans': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',

  '--text-xs': '0.75rem',
  '--text-sm': '0.875rem',
  '--text-md': '1rem',
  '--text-lg': '1.125rem',
  '--text-xl': '1.375rem',
  '--text-2xl': '1.75rem',

  '--leading-tight': '1.3',
  '--leading-body': '1.6',

  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '24px',
  '--space-6': '32px',
  '--space-7': '48px',

  '--radius-sm': '6px',
  '--radius-md': '10px',
  '--radius-lg': '16px',
  '--radius-pill': '999px',

  '--border-width': '1px',
  '--shadow': '0 1px 2px rgba(0, 0, 0, 0.16), 0 8px 24px rgba(0, 0, 0, 0.12)',
};

const DARK: Record<string, string> = {
  ...SHAPE,
  '--bg': '#0e1014',
  '--surface': '#171a21',
  '--surface-2': '#1f232c',
  '--border': '#2b303b',
  '--border-strong': '#3a4150',
  '--text': '#eef0f4',
  '--text-muted': '#98a0b0',
  '--accent': '#4f7cf7',
  '--accent-text': '#ffffff',
  '--accent-soft': '#1b2745',
  '--success': '#4ec98a',
  '--warning': '#e2b757',
  '--danger': '#f0736e',
};

const LIGHT: Record<string, string> = {
  ...SHAPE,
  '--bg': '#f6f7f9',
  '--surface': '#ffffff',
  '--surface-2': '#eef0f4',
  '--border': '#dfe3ea',
  '--border-strong': '#c3c9d4',
  '--text': '#151820',
  '--text-muted': '#5f6878',
  '--accent': '#2f5fd0',
  '--accent-text': '#ffffff',
  '--accent-soft': '#e6edfd',
  '--success': '#1f7f52',
  '--warning': '#8a6516',
  '--danger': '#c23b39',
};

const THEMES: Record<string, Theme> = {
  dark: { label: 'Dark', tokens: DARK },
  light: { label: 'Light', tokens: LIGHT },
};

/* ── stylesheets ────────────────────────────────────────────────────────── */

/** Reset and element defaults. Applies to every screen. */
const BASE = `*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--text-md);
  line-height: var(--leading-body);
  -webkit-font-smoothing: antialiased;
}

h1,
h2,
h3,
p,
figure {
  margin: 0;
}

h1 {
  font-size: var(--text-2xl);
  line-height: var(--leading-tight);
  letter-spacing: -0.01em;
}

h2 {
  font-size: var(--text-xl);
  line-height: var(--leading-tight);
}

a {
  color: var(--accent);
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}`;

/** The house style: what a screen is built out of.
 *
 *  A sheet rather than per-item CSS, because these classes belong to
 *  components that do not exist as items yet. Putting them on one screen
 *  would be a lie about who owns them, and copying them into every screen
 *  would be worse. */
const UI = `.screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-6) var(--space-5);
}

.stack {
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

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field > label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.field > input {
  padding: var(--space-3);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.field > input:focus {
  border-color: var(--accent);
  outline: none;
}

.button {
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
}

.button--quiet {
  background: transparent;
  border-color: var(--border-strong);
  color: var(--text);
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 600;
}

.notice {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--border-width) solid var(--danger);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.spacer {
  flex: 1;
}`;

/* ── screens ────────────────────────────────────────────────────────────── */

/** Every string carries a `data-t` key. That is not decoration: it is what
 *  makes a second language possible later without rewriting the markup, and
 *  the validator warns about text that has none. The starter demonstrates the
 *  habit rather than describing it. */
const SCREENS: { name: string; description: string; title: string; html: string }[] = [
  {
    name: 'sign-in',
    description: 'Sign in',
    title: 'Sign in',
    html: `<main class="screen">
  <div class="stack">
    <h1 data-t="sign-in.title">Welcome back</h1>
    <p class="muted" data-t="sign-in.subtitle">Sign in to pick up where you left off.</p>
  </div>

  <div class="stack">
    <div class="field">
      <label for="email" data-t="sign-in.email">Email</label>
      <input id="email" type="email" value="you@example.com">
    </div>
    <div class="field">
      <label for="password" data-t="sign-in.password">Password</label>
      <input id="password" type="password" value="........">
    </div>
  </div>

  <div class="stack">
    <button class="button" data-t="sign-in.submit">Sign in</button>
    <button class="button button--quiet" data-t="sign-in.forgot">I forgot my password</button>
  </div>
</main>`,
  },
  {
    name: 'sign-in-failed',
    description: 'Wrong password',
    title: 'Wrong password',
    html: `<main class="screen">
  <div class="notice">
    <h2 data-t="sign-in-failed.title">That did not match</h2>
    <p class="muted" data-t="sign-in-failed.body">The email and password do not go together. Nothing has been locked.</p>
  </div>

  <div class="stack">
    <button class="button" data-t="sign-in-failed.retry">Try again</button>
    <button class="button button--quiet" data-t="sign-in-failed.reset">Send me a reset link</button>
  </div>
</main>`,
  },
  {
    name: 'home',
    description: 'The list someone lands on',
    title: 'Home',
    html: `<main class="screen">
  <div class="row">
    <h1 data-t="home.title">Your projects</h1>
    <span class="tag" data-t="home.count">3 active</span>
  </div>

  <div class="stack">
    <article class="card">
      <div class="row">
        <strong data-t="home.item-1">Booking site</strong>
        <span class="muted" data-t="home.item-1-when">2 days ago</span>
      </div>
      <p class="muted" data-t="home.item-1-note">Three screens waiting for review.</p>
    </article>

    <article class="card">
      <div class="row">
        <strong data-t="home.item-2">Onboarding</strong>
        <span class="muted" data-t="home.item-2-when">Last week</span>
      </div>
      <p class="muted" data-t="home.item-2-note">Copy is settled; the flow is not.</p>
    </article>
  </div>

  <div class="spacer"></div>
  <button class="button" data-t="home.new">Start something new</button>
</main>`,
  },
  {
    name: 'detail',
    description: 'One thing, opened',
    title: 'Detail',
    html: `<main class="screen">
  <button class="button button--quiet" data-t="detail.back">Back</button>

  <div class="stack">
    <h1 data-t="detail.title">Booking site</h1>
    <p class="muted" data-t="detail.meta">Started 2 days ago &middot; 3 screens</p>
  </div>

  <article class="card">
    <strong data-t="detail.section">What is left</strong>
    <p class="muted" data-t="detail.body">The confirmation screen has no failure state, and the dates are still placeholders.</p>
  </article>

  <div class="spacer"></div>
  <button class="button" data-t="detail.open">Open the canvas</button>
</main>`,
  },
];

/** The connections between them: a happy path along one lane, and one branch
 *  that drops below it. Small, but it is the shape the layout is built for. */
const EDGES = [
  { id: 'edge-signed-in', from: 'sign-in', to: 'home', label: 'signed in' },
  { id: 'edge-wrong-password', from: 'sign-in', to: 'sign-in-failed', label: 'wrong password' },
  { id: 'edge-open', from: 'home', to: 'detail', label: 'open one' },
];

/* ── assembly ───────────────────────────────────────────────────────────── */

/** Text pulled back out of the markup, so the default locale is populated
 *  from the same source as the screens rather than kept in step by hand. */
function stringsOf(html: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const pattern = /data-t="([^"]+)"[^>]*>([^<]*)</g;

  let match = pattern.exec(html);
  while (match !== null) {
    const key = match[1];
    const text = (match[2] ?? '').trim();
    if (key !== undefined && text !== '') entries[key] = decode(text);
    match = pattern.exec(html);
  }
  return entries;
}

const decode = (s: string): string =>
  s
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

export function starterContent(): StarterContent {
  const items: Record<ItemName, Item> = {};
  const entries: Record<string, string> = {};
  const nodes: Flow['nodes'] = {};

  SCREENS.forEach((screen, index) => {
    items[screen.name] = {
      tier: 'screen',
      html: screen.html,
      props: {},
      fixtures: { default: { values: {} } },
      sheets: ['ui'],
      description: screen.description,
    };
    Object.assign(entries, stringsOf(screen.html));

    nodes[screen.name] = {
      screen: screen.name,
      fixture: 'default',
      title: screen.title,
      order: index + 1,
      groups: ['main'],
    };
  });

  return {
    kit: {
      preset: 'none',
      base: BASE,
      sheets: { ui: UI },
      themes: THEMES,
      defaultTheme: 'dark',
      fonts: [],
    },
    items,
    flow: {
      nodes,
      edges: Object.fromEntries(
        EDGES.map((e) => [
          e.id,
          { from: e.from, to: e.to, label: e.label, origin: 'authored' as const },
        ]),
      ),
      groups: [{ id: 'main', label: 'Main' }],
    },
    locales: { en: { label: 'English', entries } },
  };
}

/** A project with nothing in it, for someone who wants to start from their
 *  own system rather than replace ours. */
export function blankContent(): StarterContent {
  return {
    kit: {
      preset: 'none',
      base: '',
      sheets: {},
      themes: {
        dark: { label: 'Dark', tokens: DARK },
        light: { label: 'Light', tokens: LIGHT },
      },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {},
    flow: { nodes: {}, edges: {}, groups: [] },
    locales: { en: { label: 'English', entries: {} } },
  };
}

export type KitId = 'starter' | 'blank';

export const KITS: Record<KitId, { label: string; describe: string; build: () => StarterContent }> =
  {
    starter: {
      label: 'Starter',
      describe: 'A small design system and four connected screens that use it.',
      build: starterContent,
    },
    blank: {
      label: 'Blank',
      describe: 'Tokens only — no stylesheet, no screens. Bring your own system.',
      build: blankContent,
    },
  };
