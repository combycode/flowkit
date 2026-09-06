/* Attribute-string <-> map.
 *
 * Body attributes are load-bearing in this design (`body[data-spec='closed']`
 * hides the brief panel), so they have to survive import as structured data
 * rather than as a blob that gets pasted onto whatever element is handy.
 */

export function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  // name, then optionally ="value" / ='value' / =bare. A valueless attribute
  // is truthy in HTML, so it maps to the empty string rather than being lost.
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    if (!name) continue;
    out[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
