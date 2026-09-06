# Flowkit

A design system and screen-flow tool for people who work with Claude Code.

Your design lives as **one JSON file in your repo**, next to the code it
describes, committed with it. A canvas in your browser shows the real screens —
live HTML, not pictures — with the connections between them. Claude reads and
changes the design through MCP tools. You send the whole thing to somebody as a
single HTML file that opens by double-clicking it.

Nothing leaves your machine.

---

## Getting started

Flowkit runs on [Bun](https://bun.sh) — the canvas is a Bun server — so Bun has
to be installed. The package is `@combycode/flowkit`; it puts a `flowkit`
command on your PATH. Install it once, globally:

```bash
bun install -g @combycode/flowkit    # or, no install: bunx @combycode/flowkit
```

(`npm install -g @combycode/flowkit` works too, but the command still needs Bun
on your PATH to run.)

Then, in the repository whose design you want, wire up your editor:

```bash
flowkit init                  # Claude Code — writes .mcp.json here
flowkit init --client cursor  # or cursor / antigravity / opencode
flowkit config claude-desktop # a global-config app — prints what to paste
```

`init` writes the config for the client you name, wherever that client keeps it
— in the repo (Claude Code, Cursor, Antigravity, opencode) or in your home
directory (Claude Desktop, Codex, Windsurf) — and merges into an existing file
rather than replacing it, so other servers survive (Codex's TOML included).
`flowkit config <client>` does the same but only prints, for pasting by hand.
Every client points at the same `flowkit` on your PATH; pass `--npx` to invoke
it through `bunx` with no global install.

Working from a clone instead of an install:

```bash
bun install
bun run build:viewer          # the canvas; once, and after any UI change
cd packages/mcp-server/dist && bun run ../../../tools/build-package.ts  # or `bun run build` at the root
cd packages/mcp-server/dist && bun link
```

That puts a self-contained `flowkit` on your PATH built from source.

The MCP server starts the canvas itself, so once your agent is running the
canvas is there too; `flowkit serve` is for reading a design without an agent.
There is only ever one canvas per design: a second agent on the same workspace
finds the first and uses it. `flowkit ps` lists what is running, `flowkit stop`
ends it, and `--port` / `FLOWKIT_PORT` move it off the default 5190.

Then ask Claude for `overview`, or make something:

```
create_project name="My App" dir="./design"
```

A new project is not an empty one. It comes with a small design system —
colour, type, spacing and radii in a dark and a light theme, a reset, a house
style — and four connected screens that use all of it, so the canvas has
something on it from the first minute and there is a worked example to extend.
`kit="blank"` gives tokens only, for bringing your own system.

## What is where

| | |
|---|---|
| The project | one `.json` file, wherever you put it — a repo is the point |
| The canvas | http://127.0.0.1:5190/?project=&lt;id&gt; |
| Exports | `exports/` beside the project file |
| Undo log, backups, selections | your platform's application-data folder |

Projects opened from outside the default folder are remembered, so a design in
a repo is listed from then on without being re-opened by path.

## On the canvas

| | |
|---|---|
| **Drag** a screen | moves it, and saves |
| **Shift-drag** on empty canvas | rubber-band select |
| **Ctrl-click** a screen | add it to the selection |
| Drag a selection | moves all of them, as one undo step |
| Drag handle → handle | connects two screens |
| Click a connection, **Delete** | removes it |
| **Alt-drag** a rectangle | points at something, for the agent to look at |
| Scroll over a screen | pans the canvas; **Ctrl/Alt-scroll** scrolls inside it |

Screens snap to a grid so a connection can never end up hidden underneath one.
Screens cannot be deleted with a keypress — that stays deliberate, through the
tools.

Dashed connections are the importer's **guesses**. Anything you or the agent
draws is solid, because it was asserted rather than inferred.

## Asking about something you can see

Alt-drag a rectangle on the canvas, then ask Claude "why is this cramped?" It
calls `get_selection` and gets a picture of that region **and** the elements
under it — tag, classes, string key, text — so it can change the right thing
rather than guess from pixels. Reading the selection consumes it.

## Sharing

```
export_viewer
```

One HTML file with the whole canvas in it: screens where they sit, connections,
labels, and the flow, theme, language and size switches. It opens from a disk
with no server, no account and no network — attach it to a pull request or
email it. Read-only, and a snapshot: what you send stays what you sent.

`export_html` writes a folder of pages instead, and `export_png` images. Use
`export_viewer` when someone needs to understand the **flow** — a folder of
pages says nothing about how anyone gets from one screen to the next.

## Text and translation

Every visible string carries a key:

```html
<h1 data-t="04-ready.title">Ready when you are</h1>
```

For the default language the **markup is the text** — nothing is substituted.
For any other language each span is replaced by its key's entry, and a missing
entry leaves the English in place, so partial coverage renders correctly.

```
export_strings format=json            en.json — every key, for an application
export_strings format=xliff locale=ru for a translation agency
export_strings format=csv   locale=ru for a person with a spreadsheet
import_strings file=… locale=ru       take the filled-in file back
```

CSV and XLIFF **deduplicate by default**: STRAIW holds 2211 keys and 923
distinct sentences, because "Brief" is written once and lands on twenty-two
keys. Translating the short form costs less and cannot come back inconsistent;
import fans each translation across every key that holds that text. Both
formats carry the screen and the element a string appears in, because a button
reads differently from a heading. `dedupe=false` gives one row per key.

## Components, and the kit

A screen starts as plain markup. When a piece of it turns out to be shared,
lift it into the registry:

```
extract_component name=hdr-back from=01-first-run html="<a class=…>…</a>"
```

It replaces that markup everywhere it appears, then composes every screen it
touched before and after and **refuses the whole thing if a byte would
change**. Extracting the header back-link from the STRAIW design left all 62
screens still byte-identical to the original HTML.

Screens reference items with three constructs and no more:

```html
<x-field variant="confirmed">
  <x-fill slot="label"><span data-t="brief.budget">Budget</span></x-fill>
</x-field>
```

`<x-name variant="…"/>` uses an item, `<x-slot name="…">default</x-slot>`
declares a hole in one, `<x-fill slot="…">` fills it. No interpolation, no
conditions, no loops: 62 real screens were measured first and not one is
data-driven. **Variants live in the registry** (`set_variant`), so the set is
closed — a screen cannot misspell `is-confimed` into existence, and the kit
page can enumerate what exists.

Text stays a text node inside a fill, so extraction moves strings rather than
rewriting them and translation never notices.

```
build_kit
```

Generates `kit-colour`, `kit-type`, `kit-space` and `kit-components` as real
screens: they export as PNG and HTML with everything else, sit in their own
flow, and stay off the journey map. The component page **references** items
through the composer rather than describing them, so it cannot show a button
the screens do not have. Run it again after changing tokens or the registry —
`validate` reports a page that has fallen behind.

## Undo, and getting back

`undo` reverts the last change, whoever made it — you and the agent share one
history, because the canvas and the MCP tools are the same process writing to
the same store. **It survives a restart.**

Copies of the project are kept before the first change of each session and
every few minutes after. `list_backups` shows them, `restore_project` puts one
back (copying what it replaces first).

## The rules that shape it

**Every write is a command.** There is no `write_file`, no direct mutation, and
no second path — for the UI, for the agent, or for anything later. That is what
makes the contract enforceable rather than aspirational, and it is where undo,
the audit trail and eventual collaboration all come from. A rejected command
answers with what was wrong, what exists instead, and the nearest valid
alternative, so a model corrects itself in the same loop.

**Anything derivable is derived.** Two fields that can disagree eventually will.

**One renderer.** The canvas, the map, the exports and a shared snapshot all go
through `composeDocument`. What you approve is byte-for-byte what ships.

**Headless only.** Rendering uses a Chromium sidecar that never opens a window.

## Tools

Read: `list_projects` `open_project` `create_project` `overview` `list_items`
`get_item` `list_nodes` `list_edges` `validate`

Write: `create_item` `set_item_html` `set_item_css` `rename_item` `delete_item`
`add_node` `update_node` `delete_node` `connect` `disconnect` `label_connection`
`set_flow` `delete_flow` `set_strings` `add_locale` `remove_locale`
`rename_project` `rearrange` `undo`

Style: `get_tokens` `set_token` `list_sheets` `get_sheet` `set_sheet`
`delete_sheet` `update_item_sheets` `get_base` `set_base` `add_font`
`remove_font`

See: `render_screen` `render_map` `get_selection`

Recover: `list_backups` `restore_project`

Text: `get_strings` `set_strings` `export_strings` `import_strings` `add_locale`
`remove_locale`

Components: `extract_component` `list_components` `set_variant` `delete_variant`
`build_kit`

Export: `export_viewer` `export_html` `export_png` `task_status`

Place screens with **col/lane**, not pixels: one column is a screen width plus
the corridor beside it, one lane a screen height plus its captions. Pixels are
only ever right for the viewport they were measured at; grid units are right at
every size. `list_nodes` reports both.

## Layout

The canvas arranges screens from the connections: the main path runs left to
right along one lane, a branch drops below, and every connection travels
through a clear corridor. React Flow draws edges *beneath* nodes, so an edge
crossing a screen is not ugly — it is invisible. The layout guarantees that
rather than hoping for it.

A placement you make by hand wins and is kept. `rearrange` is the way back when
the canvas becomes a mess.

## Working on it

```bash
bun run check       # audit, lint, typecheck, tests — the gate before any commit
bun run dev         # build the canvas, then serve it
bun run dev:hmr     # Vite with hot reload, proxying the API to the real server
bun run mcp:call    # call any MCP tool from a shell, without restarting anything
```

`bun run mcp:call` speaks the real protocol over real stdio to the real server:

```bash
bun run mcp:call list_nodes project=my-app group=checkout
bun run mcp:call render_map project=my-app --save map.png
```

### The fidelity gates

Two checks, and it matters which one you believe.

```bash
bun run tools/verify-import.ts --all      # no snapshot: trust this one
bun run tools/verify-fidelity.ts --all    # against exported PNGs
```

`verify-import` renders the original HTML and our composed document side by
side in one browser and diffs them. Nothing external is involved, so a non-zero
result is something the import actually changed. 59 of 62 STRAIW screens are
identical; the other three are CSS animations caught mid-frame.

`verify-fidelity` compares against PNGs from the design's own exporter, which
brings in that exporter's browser and the date the snapshot was taken. It is
useful — it catches what the other cannot, because it involves a second
implementation — but it fails for reasons that are not ours. It now labels a
reference older than the design it came from, and it once reported a confident
6% that turned out to be its own launch flags setting the device scale twice.
When they disagree, `verify-import` is the one with fewer ways to be wrong.

### Dependencies

Pinned exactly, and held for **14 days** before they can be installed
(`bunfig.toml`). Compromised npm releases are usually caught within hours to
days, so a cooldown removes most of the exposure window at the cost of running
slightly older tools. `bun audit` runs as part of `check`.

What that does **not** cover, and should not be mistaken for safety:

- It buys odds, not immunity. A malicious release that goes unnoticed for three
  weeks passes straight through.
- It does nothing about a tool we *execute*. A compromised `biome` or `tsc`
  runs with our privileges whether or not it has an install hook.
- Bun does not run dependency lifecycle scripts by default, which closes the
  main worm vector — so do not add `trustedDependencies`, and do not use
  `bun add --trust` without reading the script first.

Check the current version from the registry before adding or upgrading
anything. What a model remembers about versions is months out of date.

**Accepted risks expire.** `tools/audit.ts` wraps `bun audit` with a short list
of advisories accepted as unreachable — each says why, and each has a date
after which the gate fails again. A bare `--ignore` silences an advisory for
ever and nobody revisits it; this one turns red on the day the fix becomes
installable. An acceptance is only ever right for something we cannot reach.
Everything else gets upgraded.

## Structure

This repository is a Bun **workspace** (`flowkit-workspace`) — several internal
packages that build into **one published package, `@combycode/flowkit`** (the command is `flowkit`).

```
flowkit-workspace/                  the repo root — a workspace, NOT published
├─ packages/
│  ├─ core/        @flowkit/core    document, command layer, layout, rendering — pure, no I/O
│  ├─ host/        @flowkit/host    files, the local server, the Chromium sidecar, exports
│  └─ mcp-server/  flowkit          the MCP tools + the `flowkit` CLI   ← the published package
│     └─ dist/     flowkit          `bun run build` bundles everything here; publish runs HERE
├─ apps/
│  └─ studio/      @flowkit/studio  the canvas (React); built into the viewer that ships in dist
├─ examples/cadence/                a complete demo project (see its own README)
└─ tools/                           importers, the package build, the MCP command line
```

**The one published package is `@combycode/flowkit`** (its bin is the `flowkit` command). `bun run build` compiles `core`,
`host`, `mcp-server` and the `studio` canvas into a single self-contained bundle
under `packages/mcp-server/dist/` — `flowkit.js` plus `viewer/` — and *that
folder* is what `npm publish` ships. The `@flowkit/*` packages are internal
(`private`) and never published on their own; they live inside `flowkit.js`.

`core` imports nothing from Node and nothing from the DOM, and a test fails the
build if that ever stops being true.
