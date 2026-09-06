/* Where the document comes from, and therefore what this build IS.
 *
 * One bundle, two lives:
 *
 *   · served by the local server — it fetches the project and can write to it;
 *   · exported as one file with the document baked in — it reads and nothing
 *     else, because there is nobody on the other end to write to.
 *
 * The alternative was a second, smaller viewer for sharing. That would drift:
 * the canvas people approve and the canvas people are sent would slowly stop
 * being the same thing, which is the whole reason `composeDocument` has one
 * implementation and the map reuses `placementOf`. So the shared file is this
 * application with its hands tied, not a lookalike.
 */

import type { ProjectDoc } from '@flowkit/core';
import { EMBEDDED_DOC_ID } from '@flowkit/core';

export type Source =
  | { kind: 'embedded'; doc: ProjectDoc; project: string }
  | { kind: 'server'; url: string; project: string };

export function sourceOf(): Source {
  const embedded = readEmbedded();
  if (embedded) return { kind: 'embedded', doc: embedded, project: embedded.id };

  const project = new URLSearchParams(location.search).get('project') ?? 'straiw-chat';
  return { kind: 'server', url: `/projects/${project}.json`, project };
}

/** A snapshot exported for sharing carries its document in the page.
 *
 *  Read from a script tag rather than a global: it survives minification, it
 *  cannot collide with anything, and the exporter only has to write text into
 *  a known element instead of generating JavaScript. */
function readEmbedded(): ProjectDoc | undefined {
  const el = document.getElementById(EMBEDDED_DOC_ID);
  const raw = el?.textContent?.trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ProjectDoc;
  } catch {
    // A corrupt snapshot should say so rather than silently falling back to
    // fetching a project that is not there.
    throw new Error('This shared file has a damaged project in it.');
  }
}
