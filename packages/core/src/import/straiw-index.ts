/* Read the flow metadata STRAIW already maintains.
 *
 * design/index.html carries a `SCREENS` array with, per screen: the file, its
 * flow, its ORDER within that flow, a human title and a caption. That is
 * better information than anything we could infer from filenames — the numeric
 * ranges do not line up with the flows, and the captions are hand-written
 * design notes.
 *
 * It is a JS array literal in a viewer page, so this reads it as data rather
 * than executing it. If the shape ever changes the import degrades to "no
 * metadata" instead of importing something wrong.
 */

export interface ScreenMeta {
  file: string;
  group: string;
  /** 1-based position within the flow — what the sequential edges follow. */
  order: number;
  title: string;
  caption: string;
}

export interface FlowMeta {
  id: string;
  label: string;
  note: string;
}

/** Entries of the `SCREENS = [ … ]` literal. */
export function parseScreens(indexHtml: string): ScreenMeta[] {
  const block = between(indexHtml, 'var SCREENS = [', '];');
  if (!block) return [];
  return objects(block).flatMap((o) => {
    const file = field(o, 'f');
    const group = field(o, 'flow');
    if (!file || !group) return [];
    return [
      {
        file,
        group,
        order: Number.parseInt(field(o, 'n') ?? '0', 10) || 0,
        title: decode(field(o, 't') ?? file),
        caption: decode(field(o, 'c') ?? ''),
      },
    ];
  });
}

/** Entries of the `FLOWS = [ … ]` literal, when present. */
export function parseFlows(indexHtml: string): FlowMeta[] {
  const block = between(indexHtml, 'var FLOWS = [', '];');
  if (!block) return [];
  return objects(block).flatMap((o) => {
    const id = field(o, 'id');
    if (!id) return [];
    return [{ id, label: decode(field(o, 'title') ?? id), note: decode(field(o, 'n') ?? '') }];
  });
}

function between(source: string, open: string, close: string): string | undefined {
  const start = source.indexOf(open);
  if (start === -1) return undefined;
  const from = start + open.length;
  const end = source.indexOf(close, from);
  return end === -1 ? undefined : source.slice(from, end);
}

/** Split a literal into its `{ … }` entries. Values here contain no braces,
 *  which keeps this a scan rather than a parser. */
function objects(block: string): string[] {
  return [...block.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? '');
}

/** `key: 'value'` or `key: 123` within one entry. */
function field(entry: string, key: string): string | undefined {
  const quoted = new RegExp(`\\b${key}\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(entry);
  if (quoted?.[1] !== undefined) return quoted[1];
  const bare = new RegExp(`\\b${key}\\s*:\\s*([0-9]+)`).exec(entry);
  return bare?.[1];
}

/** The captions are written for HTML, so they carry entities and inline tags.
 *  Node titles and descriptions are plain text, so both are resolved here —
 *  otherwise the canvas shows `Files &amp; links` and stray `<b>`. */
function decode(s: string): string {
  return s
    .replace(/\\'/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
