/* The HTML parser core needs, as a port.
 *
 * Core imports neither Node nor the DOM, so it cannot reach for `DOMParser`
 * (browser-only) or `HTMLRewriter` (Bun-only) directly. Each host supplies
 * one:
 *
 *   host-local / mcp    Bun's HTMLRewriter, or a small pure parser
 *   host-web / viewer   DOMParser
 *   sidecar             whatever the page already has
 *
 * The tree is deliberately the smallest thing the renderer and the validator
 * both need. It is not a DOM: no parent links, no live collections, no
 * mutation methods. Anything that walks it is a pure function over a value,
 * which is what makes the renderer testable without a browser.
 */

export interface TextNode {
  kind: 'text';
  text: string;
}

export interface ElementNode {
  kind: 'element';
  /** Lowercased. `x-button` for a registry reference; anything else is plain
   *  markup. Distinguishing them is a name check, not a parser concern. */
  tag: string;
  attrs: Readonly<Record<string, string>>;
  children: readonly Node[];
  /** 1-indexed, for `Diagnostic.line`. Optional because not every parser can
   *  report it, and a diagnostic without a line is still useful. */
  line?: number;
}

export type Node = TextNode | ElementNode;

export interface HtmlParser {
  /** Parse a fragment. Must not throw on malformed input — return what was
   *  understood, so a half-typed template still previews. */
  parse(html: string): readonly Node[];
}

/** Serialise back to HTML. Separate from the parser because the sidecar and
 *  the browser both parse, but only the renderer serialises. */
export interface HtmlSerializer {
  serialize(nodes: readonly Node[]): string;
}
