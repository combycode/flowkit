/* Writing, from the studio.
 *
 * A command, not a document. The studio never sends JSON to be saved — it
 * sends the same command an MCP tool would send, to the same validator, and
 * gets the same diagnostics back if it is wrong. That is what keeps "there is
 * exactly one write path" true now that the canvas can write at all.
 *
 * Under the desktop host this becomes a call into the host process and
 * nothing above this line changes.
 */

import type { Command } from '@flowkit/core';

export interface CommandOutcome {
  ok: boolean;
  /** Present when the command layer rejected it — worth showing, not swallowing. */
  message?: string;
}

export async function send(
  project: string,
  commands: Command | readonly Command[],
): Promise<CommandOutcome> {
  try {
    const res = await fetch(`/command/${project}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      diagnostics?: { message: string }[];
    };

    if (res.ok && body.ok !== false) return { ok: true };
    return {
      ok: false,
      message: body.diagnostics?.map((d) => d.message).join('; ') ?? body.error ?? res.statusText,
    };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
