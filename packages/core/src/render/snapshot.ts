/* The contract between an exported file and the application inside it.
 *
 * A snapshot is one HTML file: the studio's bundle, plus the project document
 * in a script tag. The exporter writes that tag; the application reads it and
 * puts itself in read-only mode because there is nothing behind it to write
 * to.
 *
 * One string joins them, and if the two sides ever disagree about it the
 * failure is silent — the application finds no document, falls through to
 * fetching one from a server that is not there, and the recipient gets an
 * error page instead of a design. So it lives here, in the package both sides
 * already depend on, rather than being written twice and hoped over.
 */

/** The `<script type="application/json">` holding the project document. */
export const EMBEDDED_DOC_ID = 'flowkit-doc';
