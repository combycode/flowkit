# Changelog

All notable changes to Flowkit are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The Chromium sidecar now finds a browser on macOS and Linux, not just Windows.
  The Playwright browser-cache lookup was keyed off `LOCALAPPDATA` — a
  Windows-only variable — so a downloaded Chromium was invisible off Windows.
  The per-OS cache directories (`~/Library/Caches/ms-playwright`,
  `~/.cache/ms-playwright`) are searched too now, and the system-browser list
  gained macOS Edge/Chromium and the common Linux binaries. `FLOWKIT_CHROME`
  still overrides everything.

### Changed

- CI runs the full gate on macOS as well as Linux (`.github/workflows/ci.yml`),
  so cross-platform regressions — browser discovery included — fail before a release.

## [0.1.2] — tool annotations, canvas and selection fixes, GUI-ready configs

### Added

- Every tool now carries MCP annotations — `readOnlyHint` on the readers,
  `readOnlyHint: false` with `destructiveHint: false` on the writers (flowkit's
  writes are reversible: validated, and undone by `undo`). Clients that honour
  annotations can auto-approve reads and confirm only writes, instead of asking
  on every call.
- `get_selection` with no `project` now returns every waiting gesture across
  ALL open canvases, oldest first — so a question about "this", asked while
  looking at a canvas that was opened by URL (and never selected as the active
  project), reaches it, and two gestures in two projects can be compared in one
  question.

### Fixed

- `flowkit --workspace <dir>` (and any invocation whose first argument is a
  flag) started the server instead of failing with "Unknown command" — this is
  exactly the form an MCP client's config passes, so a config without an
  explicit verb now works.
- The server (with its canvas) now exits when its client disconnects — a GUI
  client closes the stdio pipe rather than signalling, and the canvas would
  otherwise keep the process, and its port, alive after the client had gone.
- The canvas tab is now titled after the project, not a fixed "Design Flow", so
  several designs open at once are told apart.
- A selection now expires ten minutes after it is made — pruned on every read
  and count — so a stale gesture no longer haunts a later, unrelated question
  and the header badge never counts one that no longer means anything.
- `flowkit init`/`config` now write the ABSOLUTE path to the installed flowkit,
  because a GUI client (Claude Desktop, Cursor, Windsurf) is launched from the
  desktop and its PATH does not include `~/.bun/bin` — a bare `flowkit` command
  worked in a terminal but failed silently there. Set `FLOWKIT_BIN` to override.

## [0.1.1] — install fixes

### Fixed

- `flowkit --version` crashed on a real install (`ENOENT … @combycode/package.json`).
  The bin read its `package.json` one directory up — correct only in a `bun link`
  layout, not in `node_modules/@combycode/flowkit/`, where the manifest sits beside
  the bundle. It now reads whichever `package.json` is with the code.
- `flowkit export` spawned a `main.ts` that exists only in the source tree; on a
  real install it now re-runs the installed binary itself in `mcp` mode.
- The release workflow now smoke-runs the built CLI's `--version`, so a bundle
  path bug fails CI instead of shipping.

## [0.1.0] — first release

The design lives as one JSON document in your repo and is edited only through
MCP tools; a browser canvas shows the real screens as live HTML, and the whole
design exports to a single self-contained HTML file.

### Added

- **One-document model.** A project is a single JSON file. Every write goes
  through a typed command layer with validation, an op-log, and undo — there is
  no file-write tool and no way to change the document any other way.
- **MCP server.** Screens and parts are exposed as `screen://` and `part://`
  resources for `@`-mention; every editing tool reports its diagnostics
  verbatim on rejection, naming what would have been accepted instead.
- **Canvas.** A local viewer renders each screen as live HTML (not a picture),
  with the connections between them, and lets you ask about anything on screen.
- **The kit.** A design system built from the registry — foundation
  (colour, type, sizes, icons) plus a sheet per tier — that stays true to what
  the screens actually use, and is flagged stale when they move under it.
- **Composer.** Reusable parts via `<x-name>`/`<x-slot>`/`<x-fill>`, with
  variants carrying a class, attributes, or their own markup.
- **`extract_component`.** Folds a repeated spelling into a component, including
  variants that differ inside the element, not only by a root class.
- **`batch`.** A list of ordinary tool calls applied as one transaction with
  one undo — for mass renames, creating and wiring a flow of screens, or
  repointing many nodes. Later steps see earlier ones; if any step is rejected
  nothing is written; only the end state is validated.
- **Per-viewport placement.** Nodes can carry a shared placement and
  per-viewport overrides, with the canvas and tools reporting which one wins.
- **Export.** PNG (via a Chromium sidecar, with animations frozen for
  deterministic frames), standalone HTML, a shareable one-file HTML bundle,
  and a design spec.
- **Text and translation.** Every visible string carries a key; generated kit
  pages are never offered for translation.

[Unreleased]: https://github.com/combycode/flowkit/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/combycode/flowkit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/combycode/flowkit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/combycode/flowkit/releases/tag/v0.1.0
