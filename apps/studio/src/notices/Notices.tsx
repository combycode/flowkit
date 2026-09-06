/* The notices, on screen.
 *
 * Bottom centre, over the canvas, dismissible. Deliberately not a modal: a
 * refused drag is not something to interrupt someone for, it is something
 * they need to be able to read. */

import { useEffect, useState } from 'react';
import { dismiss, type Notice, subscribe } from './bus';

export function Notices() {
  const [notices, setNotices] = useState<readonly Notice[]>([]);

  useEffect(() => subscribe(setNotices), []);

  if (notices.length === 0) return null;

  return (
    <output className="notices" aria-live="polite">
      {notices.map((notice) => (
        <button
          key={notice.id}
          type="button"
          className={`notice notice--${notice.kind}`}
          onClick={() => dismiss(notice.id)}
          title="Dismiss"
        >
          <span className="notice__message">{notice.message}</span>
          {notice.hint ? <span className="notice__hint">{notice.hint}</span> : null}
        </button>
      ))}
    </output>
  );
}
