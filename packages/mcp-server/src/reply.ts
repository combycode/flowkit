/* Turning a CommandResult into something a model can act on.
 *
 * A rejection is the most valuable message this server sends. It has to say
 * what was wrong, what would have been accepted, and the nearest alternative
 * — in that order — so the next call is a fix rather than another probe.
 *
 * Kept apart from the tool definitions because it is the one piece of
 * formatting worth getting right once and reusing everywhere.
 */

import type { CommandResult, Diagnostic } from '@flowkit/core';

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface ToolReply {
  content: ToolContent[];
  isError?: boolean;
}

export const text = (body: string): ToolReply => ({ content: [{ type: 'text', text: body }] });

export const failure = (body: string): ToolReply => ({
  content: [{ type: 'text', text: body }],
  isError: true,
});

export function fromResult(result: CommandResult, success: string): ToolReply {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');

  if (!result.ok) {
    return failure(['Rejected — nothing was changed.', '', ...errors.map(describe)].join('\n'));
  }

  const lines = [success];
  if (warnings.length > 0) {
    lines.push('', `${warnings.length} warning(s) — applied anyway:`, ...warnings.map(describe));
  }
  return text(lines.join('\n'));
}

function describe(d: Diagnostic): string {
  const where = [
    d.item && `item "${d.item}"`,
    d.node && `node "${d.node}"`,
    d.line && `line ${d.line}`,
  ]
    .filter(Boolean)
    .join(', ');

  const parts = [`- [${d.code}]${where ? ` ${where}:` : ''} ${d.message}`];
  if (d.available && d.available.length > 0) {
    parts.push(`  available: ${d.available.join(', ')}`);
  }
  return parts.join('\n');
}
