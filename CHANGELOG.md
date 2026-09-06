# Changelog

All notable changes to Flowkit are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-rc] — first release candidate

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

[Unreleased]: https://github.com/combycode/flowkit/compare/v0.1.0-rc...HEAD
[0.1.0-rc]: https://github.com/combycode/flowkit/releases/tag/v0.1.0-rc
