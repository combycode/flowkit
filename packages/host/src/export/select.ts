/* Deciding what an export covers.
 *
 * Both exporters face the same question — which screens, at which viewport,
 * theme and locale — so it is answered once here rather than twice, slightly
 * differently.
 *
 * The default is EVERY screen at EVERY viewport in EVERY theme, in the default
 * locale. That is what the reference export produces (STRAIW's own exports/
 * holds `<screen>@<size>-<theme>.png` for both sizes and both themes), and a
 * contact sheet exported with one theme has a theme switcher that does
 * nothing — a deliverable with dead controls is worse than a bigger one.
 *
 * Locale is the exception, and stays narrow. A translation is reviewed as a
 * pass over the design rather than shipped alongside it, and including every
 * language multiplies an already large export by the number of languages.
 */

import type { ProjectDoc, RenderContext, Viewport } from '@flowkit/core';

export interface ExportSelection {
  /** Screen item names. Defaults to every node on the canvas, in flow order. */
  screens?: readonly string[];
  viewports?: readonly string[];
  themes?: readonly string[];
  locales?: readonly string[];

  /** Only screens in these flows.
   *
   *  Composes with `screens` rather than replacing it: both narrow, so naming
   *  a flow AND a list means the screens from that list which are in it. */
  groups?: readonly string[];

  /** What to do with generated pages — the kit sheets.
   *
   *  They are screens on the canvas like any other, so by default they export
   *  with everything else, and an export meant for a client arrives with five
   *  pages of internals in it. 'exclude' leaves them out; 'only' is how you
   *  hand somebody the design system and nothing else. */
  generated?: 'only' | 'exclude';
}

export interface ExportJob {
  item: string;
  /** Node title where there is one, so a file is named the way the canvas
   *  labels it rather than by an internal id. */
  label: string;
  description?: string;
  group?: string;
  order?: number;
  viewport: Viewport;
  ctx: RenderContext;
}

export function screensToExport(doc: ProjectDoc, sel: ExportSelection): ExportJob[] {
  const everyViewport = doc.viewports.map((v) => v.id);
  const everyTheme = Object.keys(doc.kit.themes);

  const viewports = pick(everyViewport, sel.viewports, everyViewport);
  const themes = pick(everyTheme, sel.themes, everyTheme);
  // Default locale only — see the note at the top.
  const locales = pick(Object.keys(doc.strings.locales), sel.locales, [doc.strings.defaultLocale]);

  // Canvas order, not object order: the flow is the order a person reads these
  // in, and an export that shuffles them is harder to review than one folder
  // of files in sequence.
  const nodes = Object.values(doc.flow.nodes).sort(byGroupThenOrder(doc));
  const inGroup = (screen: string): boolean => {
    if (!sel.groups || sel.groups.length === 0) return true;
    const node = nodes.find((n) => n.screen === screen);
    return (node?.groups ?? []).some((g) => sel.groups?.includes(g));
  };

  const wantedKind = (screen: string): boolean => {
    if (!sel.generated) return true;
    const made = doc.items[screen]?.generated !== undefined;
    return sel.generated === 'only' ? made : !made;
  };

  const wanted = (
    sel.screens ? sel.screens.filter((name) => doc.items[name]) : nodes.map((n) => n.screen)
  ).filter((name) => inGroup(name) && wantedKind(name));

  const jobs: ExportJob[] = [];
  for (const item of dedupe(wanted)) {
    const node = nodes.find((n) => n.screen === item);

    /* A screen that measured itself is exported at that size, once — not at
     * every viewport in the list, which would be the same picture several
     * times under different names, each of them cut off. */
    const own = doc.items[item]?.size;
    const ids = own ? [doc.items[item]?.viewport ?? viewports[0] ?? ''] : viewports;

    for (const viewportId of ids) {
      const found = doc.viewports.find((v) => v.id === viewportId);
      if (!found) continue;
      const viewport = own ? { ...found, ...own } : found;
      for (const theme of themes) {
        for (const locale of locales) {
          jobs.push({
            item,
            label: node?.title ?? item,
            ...(node?.description !== undefined ? { description: node.description } : {}),
            ...(node?.groups?.[0] !== undefined ? { group: node.groups[0] } : {}),
            ...(node?.order !== undefined ? { order: node.order } : {}),
            viewport,
            ctx: {
              theme,
              locale,
              viewport: viewportId,
              ...(node ? { fixture: node.fixture } : {}),
            },
          });
        }
      }
    }
  }
  return jobs;
}

/** Requested values that actually exist, or the fallback. An unknown id is
 *  dropped rather than failing the whole export — one bad flag should not
 *  cost someone sixty renders. */
function pick(
  available: readonly string[],
  requested: readonly string[] | undefined,
  fallback: readonly string[],
): string[] {
  if (!requested || requested.length === 0) return [...fallback];
  const kept = requested.filter((r) => available.includes(r));
  return kept.length > 0 ? kept : [...fallback];
}

const byGroupThenOrder =
  (doc: ProjectDoc) =>
  (
    a: { groups?: readonly string[]; order?: number },
    b: { groups?: readonly string[]; order?: number },
  ) => {
    const rank = (n: typeof a) => {
      const id = n.groups?.[0];
      const at = doc.flow.groups.findIndex((g) => g.id === id);
      return at === -1 ? doc.flow.groups.length : at;
    };
    const byGroup = rank(a) - rank(b);
    if (byGroup !== 0) return byGroup;
    return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
  };

const dedupe = <T>(items: readonly T[]): T[] => [...new Set(items)];
