/* The contact sheet.
 *
 * Modelled on STRAIW's own design/index.html, because that page is the thing
 * people actually look at: every screen at once, grouped by flow, with the
 * filters that make 62 screens navigable — size, theme, and which journey.
 *
 * Two differences from theirs, both earned:
 *   - the filters are generated from the document, so a new flow, theme or
 *     language appears without anyone editing a page;
 *   - each screen lists what it connects to, which their sheet could not show
 *     because the connections did not exist as data.
 *
 * Self-contained apart from the screens it frames: no build step, no network,
 * opens straight from a file:// path.
 */

import type { ProjectDoc } from '@flowkit/core';
import type { ExportJob } from './select';

export interface IndexInput {
  doc: ProjectDoc;
  jobs: readonly ExportJob[];
  /** Screen file name for a job, relative to the index. */
  fileOf: (job: ExportJob) => string;
}

/** Sentinel for "belongs to no flow".
 *
 *  It has to be a value the markup and the filter script agree on. They did
 *  not on the first pass — one wrote a space-prefixed string and the other
 *  compared against an escape — and the Ungrouped filter silently matched
 *  nothing, which looks exactly like having no ungrouped screens. */
const UNGROUPED = '__none__';

export function renderIndex({ doc, jobs, fileOf }: IndexInput): string {
  const viewports = unique(jobs.map((j) => j.viewport.id));
  const themes = unique(jobs.map((j) => j.ctx.theme));
  const locales = unique(jobs.map((j) => j.ctx.locale));
  const groups = doc.flow.groups.filter((g) => jobs.some((j) => j.group === g.id));
  const hasUngrouped = jobs.some((j) => j.group === undefined);

  const cells = jobs.map((job) => {
    const v = job.viewport;
    return [
      `<figure class="cell" data-viewport="${attr(v.id)}" data-theme="${attr(job.ctx.theme)}"`,
      ` data-locale="${attr(job.ctx.locale)}" data-group="${attr(job.group ?? '')}"`,
      // The counter counts SCREENS, and one screen has a cell per size and
      // theme. Without this it reported 248 for a 62-screen design.
      ` data-item="${attr(job.item)}">`,
      `<figcaption class="cap-top"><b>${esc(job.label)}</b><span>${esc(job.item)}</span></figcaption>`,
      `<div class="frame frame--${attr(v.device)}" style="width:${v.width}px;height:${v.height}px">`,
      `<iframe loading="lazy" src="${attr(fileOf(job))}" title="${attr(job.label)}"`,
      ` width="${v.width}" height="${v.height}"></iframe></div>`,
      job.description ? `<figcaption class="cap">${esc(job.description)}</figcaption>` : '',
      connectionsOf(doc, job.item),
      '</figure>',
    ].join('\n');
  });

  const bar = [
    `<strong>${esc(doc.name)}</strong>`,
    filter('Flow', 'group', [
      { id: '', label: 'All' },
      ...groups.map((g) => ({ id: g.id, label: g.label })),
      ...(hasUngrouped ? [{ id: UNGROUPED, label: 'Ungrouped' }] : []),
    ]),
    viewports.length > 1
      ? filter(
          'Size',
          'viewport',
          viewports.map((id) => ({ id, label: viewportLabel(doc, id) })),
        )
      : '',
    themes.length > 1
      ? filter(
          'Theme',
          'theme',
          themes.map((id) => ({ id, label: themeLabel(doc, id) })),
        )
      : '',
    locales.length > 1
      ? filter(
          'Language',
          'locale',
          locales.map((id) => ({ id, label: localeLabel(doc, id) })),
        )
      : '',
    `<span class="count"><b id="shown">${unique(jobs.map((j) => j.item)).length}</b> / ` +
      `${unique(jobs.map((j) => j.item)).length} screens</span>`,
  ]
    .filter(Boolean)
    .join('\n  ');

  return [
    '<!DOCTYPE html>',
    `<html lang="${attr(doc.strings.defaultLocale)}">`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(doc.name)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<header class="bar">\n  ${bar}\n</header>`,
    `<main id="sheet">\n${cells.join('\n')}\n</main>`,
    `<script>${script(UNGROUPED)}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** What a screen leads to, taken from the flow. */
function connectionsOf(doc: ProjectDoc, item: string): string {
  const nodeIds = Object.entries(doc.flow.nodes)
    .filter(([, n]) => n.screen === item)
    .map(([id]) => id);
  if (nodeIds.length === 0) return '';

  const out = Object.values(doc.flow.edges)
    .filter((e) => nodeIds.includes(e.from))
    .map((e) => {
      const target = doc.flow.nodes[e.to];
      const label = target?.title ?? target?.screen ?? e.to;
      // An inferred connection is shown as inferred. Presenting a guess with
      // the same weight as something a person drew is how a guess becomes
      // believed.
      const cls = e.origin === 'auto' ? ' class="assumed"' : '';
      return `<li${cls}>${e.label ? `${esc(e.label)} ` : ''}&rarr; ${esc(label)}</li>`;
    });

  return out.length === 0 ? '' : `<ul class="links">${out.join('')}</ul>`;
}

function filter(label: string, key: string, options: { id: string; label: string }[]): string {
  const buttons = options
    .map(
      (o, i) =>
        `<button data-value="${attr(o.id)}"${i === 0 ? ' aria-pressed="true"' : ''}>` +
        `${esc(o.label)}</button>`,
    )
    .join('');
  return `<div class="seg" data-filter="${attr(key)}"><span>${esc(label)}</span><div>${buttons}</div></div>`;
}

const viewportLabel = (doc: ProjectDoc, id: string): string =>
  doc.viewports.find((v) => v.id === id)?.label ?? id;
const themeLabel = (doc: ProjectDoc, id: string): string => doc.kit.themes[id]?.label ?? id;
const localeLabel = (doc: ProjectDoc, id: string): string => doc.strings.locales[id]?.label ?? id;

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string): string => esc(s).replace(/"/g, '&quot;');

/* The sheet is chrome around the screens and deliberately owns no design of
   its own — the screens bring theirs, and the frame must not compete. */
const STYLE = `
:root { color-scheme: dark; --ink:#e7e9f0; --dim:#9aa2b5; --line:#262a35; --panel:#14161d; --bg:#0b0c10; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:13px/1.5 ui-sans-serif, system-ui, sans-serif; }
.bar { position:sticky; top:0; z-index:5; display:flex; gap:20px; align-items:center;
  flex-wrap:wrap; padding:10px 16px; background:var(--panel); border-bottom:1px solid var(--line); }
.bar strong { font-size:14px; }
.count { margin-left:auto; color:var(--dim); font-variant-numeric:tabular-nums; }
.seg { display:flex; align-items:center; gap:8px; }
.seg > span { color:var(--dim); }
.seg > div { display:flex; border:1px solid var(--line); border-radius:7px; overflow:hidden; }
.seg button { background:none; border:0; border-left:1px solid var(--line); color:var(--dim);
  font:inherit; padding:4px 10px; cursor:pointer; }
.seg button:first-child { border-left:0; }
.seg button:hover { color:var(--ink); }
.seg button[aria-pressed="true"] { background:#4a7cf7; color:#fff; }
#sheet { display:flex; flex-wrap:wrap; gap:34px; padding:28px 16px 120px; align-items:flex-start; }
.cell[hidden] { display:none; }
.cap-top { margin-bottom:8px; font-size:14px; }
.cap-top span { color:var(--dim); margin-left:8px; font-size:12px; }
.frame { border:1px solid rgba(255,255,255,.13); overflow:hidden; background:#0f1117;
  box-shadow:0 20px 60px rgba(0,0,0,.35); }
/* A phone reads as a phone and a window as a window; getting this wrong makes
   every screen look like the wrong device at a glance. */
.frame--mobile { border-radius:26px; }
.frame--desktop { border-radius:10px; }
.frame iframe { border:0; display:block; }
.cap { margin-top:10px; color:var(--dim); max-width:390px; }
.links { margin:8px 0 0; padding:0; list-style:none; color:var(--dim); max-width:390px; }
.links li { padding:1px 0; }
.links li.assumed { opacity:.65; font-style:italic; }
.links li.assumed::after { content:' (assumed)'; opacity:.7; font-style:normal; }
`;

/* Filtering is attribute matching and nothing else: no framework, no build,
   and the page still works opened straight off a disk. */
const script = (ungrouped: string): string => `
(function () {
  var UNGROUPED = ${JSON.stringify(ungrouped)};
  var state = {};
  document.querySelectorAll('.seg').forEach(function (seg) {
    var key = seg.dataset.filter;
    state[key] = seg.querySelector('button').dataset.value;
    seg.addEventListener('click', function (e) {
      var button = e.target.closest('button');
      if (!button) return;
      state[key] = button.dataset.value;
      seg.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === button));
      });
      apply();
    });
  });
  function apply() {
    // Count screens, not cells. One screen has a cell per size and per theme,
    // so counting cells reported 248 for a design of 62 screens — a number
    // that answers a question nobody asked.
    var seen = {};
    document.querySelectorAll('.cell').forEach(function (cell) {
      var ok = Object.keys(state).every(function (key) {
        var want = state[key];
        if (want === '') return true;
        if (want === UNGROUPED) return cell.dataset[key] === '';
        return cell.dataset[key] === want;
      });
      cell.hidden = !ok;
      if (ok) seen[cell.dataset.item] = true;
    });
    document.getElementById('shown').textContent = String(Object.keys(seen).length);
  }
  apply();
})();
`;
