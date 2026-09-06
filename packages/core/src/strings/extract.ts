/* Text extraction and localisation.
 *
 * The default locale's text stays INLINE in the html, with a key beside it:
 *
 *     <h1 data-t="auth.sign-in">Sign in</h1>
 *
 * One write per edit, the template renders correctly with no resolution step,
 * and the key is there for extraction. Other locales are overlays applied at
 * render; a key they lack falls back to what is already in the markup, so a
 * half-translated project renders rather than showing holes.
 *
 * An element may hold several text nodes around its children —
 * `<button><span/>Build a website<svg/></button>` is the common shape here —
 * so `data-t` carries one key per text node, pipe-separated, in document
 * order. Restricting this to leaf elements missed most of the copy in this
 * design: five keys on the first screen instead of eleven.
 *
 * Both operations splice the source string at scanned offsets. Nothing
 * round-trips through a parse tree, so every byte we do not deliberately
 * change is preserved — which is what keeps the import pixel-identical.
 */

import { type ElementText, scanText } from '../html/scan';

export interface Extraction {
  html: string;
  entries: Record<string, string>;
  /** Text nodes found and given a NEW key. */
  keyed: number;
  /** Text already carrying a data-t key that had no entry yet, now filled from
   *  the markup. Separate from `keyed` because no markup changed for these. */
  backfilled: number;
}

/** Pull visible text into the string table.
 *
 *  Two jobs, because hand-authored markup and generated markup both arrive
 *  here. Unstamped text gets a fresh key AND an entry. Text that ALREADY has a
 *  data-t but whose key has no entry — the case where someone wrote the key by
 *  hand and never set the string — gets its entry filled from the markup, so
 *  the design does not sit on a `missing-string` warning with no obvious tool
 *  to clear it. `existing` names the keys already in the target locale, so a
 *  translation that is already set is never overwritten.
 */
export function extractStrings(
  html: string,
  prefix: string,
  existing: ReadonlySet<string> = new Set(),
): Extraction {
  const entries: Record<string, string> = {};
  const used = new Set<string>(existing);
  const edits: { at: number; end: number; text: string }[] = [];
  let keyed = 0;
  let backfilled = 0;

  const elements = [...scanText(html)];

  // Pre-pass: every key ALREADY stamped in the markup is taken, wherever it
  // appears — so a new auto-key generated below can never collide with a
  // hand-authored data-t and overwrite its text, whichever comes first.
  for (const el of elements) {
    const stamped = attrValue(html, el, 'data-t');
    if (stamped === undefined) continue;
    for (const key of stamped.split('|')) if (key) used.add(key);
  }

  for (const el of elements) {
    const stamped = attrValue(html, el, 'data-t');
    if (stamped !== undefined) {
      // Already keyed: fill only the entries that are missing, matching each
      // key to its text span in order (a joined `a|b` keys two spans).
      const keys = stamped.split('|');
      el.texts.forEach((span, i) => {
        const key = keys[i];
        if (!key || existing.has(key) || entries[key] !== undefined) return;
        entries[key] = html.slice(span.start, span.end).trim();
        backfilled++;
      });
      continue;
    }

    const keys: string[] = [];
    for (const span of el.texts) {
      const raw = html.slice(span.start, span.end);
      const key = uniqueKey(prefix, raw, used);
      entries[key] = raw.trim();
      keys.push(key);
      keyed++;
    }
    if (keys.length === 0) continue;

    edits.push({
      at: el.attrInsertAt,
      end: el.attrInsertAt,
      text: ` data-t="${keys.join('|')}"`,
    });
  }

  return { html: splice(html, edits), entries, keyed, backfilled };
}

/** Swap in another locale. A key with no entry keeps the inline default. */
export function applyStrings(html: string, entries: Readonly<Record<string, string>>): string {
  if (Object.keys(entries).length === 0) return html;

  const edits: { at: number; end: number; text: string }[] = [];
  for (const el of scanText(html)) {
    const keys = attrValue(html, el, 'data-t')?.split('|');
    if (!keys) continue;

    el.texts.forEach((span, i) => {
      const key = keys[i];
      const replacement = key === undefined ? undefined : entries[key];
      if (replacement === undefined) return;
      const raw = html.slice(span.start, span.end);
      // Keep the original surrounding whitespace: between inline elements it
      // is a real space, and dropping it runs words together.
      const lead = /^\s*/.exec(raw)?.[0] ?? '';
      const tail = /\s*$/.exec(raw)?.[0] ?? '';
      edits.push({ at: span.start, end: span.end, text: lead + escapeText(replacement) + tail });
    });
  }

  return splice(html, edits);
}

/** Apply edits back-to-front so earlier offsets stay valid. */
function splice(
  source: string,
  edits: readonly { at: number; end: number; text: string }[],
): string {
  let out = source;
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.end);
  }
  return out;
}

const openTag = (html: string, el: ElementText): string => html.slice(el.openStart, el.openEnd);

const attrValue = (html: string, el: ElementText, name: string): string | undefined =>
  new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(openTag(html, el))?.[1];

/** `screen.slug-of-the-text`. Readable, so a translator can tell what a key
 *  is from the key alone; suffixed on collision so it stays unique. */
function uniqueKey(prefix: string, text: string, used: Set<string>): string {
  const slug =
    text
      .trim()
      .toLowerCase()
      .replace(/&[a-zA-Z#0-9]+;/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .split('-')
      .filter(Boolean)
      .slice(0, 6)
      .join('-')
      .slice(0, 48) || 'text';

  const base = `${prefix}.${slug}`;
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  used.add(key);
  return key;
}

const escapeText = (s: string): string => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
