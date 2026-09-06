/* Putting data inside a script tag without letting it escape.
 *
 * `</script>` in embedded content ends the tag early and turns everything
 * after it into text — a blank page, or worse, markup the author did not
 * write. It is the one escape that matters when a page carries its own data,
 * and the one everyone forgets.
 *
 * The sequence has to stay valid in the language it is written in, so each
 * payload gets its own treatment. Shared here rather than copied, because a
 * security-relevant escape that exists twice is one that gets fixed once.
 */

const BACKSLASH = String.fromCharCode(92);

/** In JSON a backslash-escaped solidus is legal, so every `</` can be split. */
export const escapeJson = (s: string): string => s.replace(/<[/]/g, `<${BACKSLASH}/`);

/** In CSS the same escape is legal only inside a string, so only the actual
 *  closing tag is touched and nothing else is disturbed. */
export const escapeCss = (s: string): string => s.replace(/<[/]script/gi, `<${BACKSLASH}/script`);

/** In JavaScript, likewise: the sequence can only legitimately appear inside a
 *  string literal, where the escape is valid and means the same thing. This is
 *  what every bundler does when it inlines a script. */
export const escapeJs = (s: string): string => s.replace(/<[/]script/gi, `<${BACKSLASH}/script`);
