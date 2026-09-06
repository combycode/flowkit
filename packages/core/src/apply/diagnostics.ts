/* Building diagnostics.
 *
 * A rejection is a teaching moment. `available` in particular is what lets a
 * model fix itself in one step instead of probing: it says what WOULD have
 * been accepted, right where the mistake was made. */

import type { Diagnostic, DiagnosticCode } from '../types/commands';

export interface DiagnosticInput {
  code: DiagnosticCode;
  message: string;
  severity?: 'error' | 'warning';
  item?: string;
  node?: string;
  line?: number;
  suggestion?: string;
  available?: readonly string[];
}

export function diagnostic(input: DiagnosticInput): Diagnostic {
  const { severity = 'error', available, ...rest } = input;
  return {
    ...rest,
    severity,
    ...(available && available.length > 0 ? { available: [...available] } : {}),
  };
}

/** "unknown X, did you mean Y" — the shape most preconditions need. */
export function unknown(
  code: DiagnosticCode,
  kind: string,
  name: string,
  valid: readonly string[],
): Diagnostic {
  const near = nearest(name, valid);
  return diagnostic({
    code,
    message: `No ${kind} named "${name}".${near ? ` Did you mean "${near}"?` : ''}`,
    ...(near ? { suggestion: near } : {}),
    // Capped: a hundred item names in one message helps nobody, and the
    // listing exists to orient rather than to enumerate.
    available: valid.slice(0, 25),
  });
}

export const hasError = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === 'error');

/** Nearest candidate by edit distance, when one is close enough to be a
 *  plausible typo rather than a different word entirely. */
export function nearest(candidate: string, valid: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  const limit = Math.max(2, Math.floor(candidate.length / 3));
  for (const option of valid) {
    const score = distance(candidate, option);
    if (score < bestScore && score <= limit) {
      best = option;
      bestScore = score;
    }
  }
  return best;
}

/** Levenshtein, two rows rather than a full matrix. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length] ?? Number.POSITIVE_INFINITY;
}
