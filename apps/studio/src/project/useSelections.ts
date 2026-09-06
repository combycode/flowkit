/* How many gestures are waiting for the agent.
 *
 * A person alt-drags three rectangles and then asks one question. Until they
 * ask, nothing on the screen said the three had been recorded — so a selection
 * that silently failed and a selection waiting to be read looked identical.
 * This is the difference: a count in the header that goes up as they point and
 * back to nothing once the agent has read them.
 *
 * Polled rather than pushed. The reader is another process, and the same
 * polling that keeps the document fresh is already the studio's model of "the
 * world may have changed underneath us".
 */

import { useEffect, useState } from 'react';

/** In step with the document poll. Cheap: a number, from a file read. */
const POLL_MS = 1500;

export function useSelections(project: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!project) {
      setCount(0);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/selection/${encodeURIComponent(project)}`);
        const body = (await res.json()) as { count?: number };
        if (!cancelled) setCount(body.count ?? 0);
      } catch {
        /* A failed poll means nothing: the next one may succeed, and a header
           badge is not worth tearing anything down for. */
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [project]);

  return count;
}
