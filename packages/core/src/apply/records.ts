/* Immutable helpers for the keyed collections the document is built from.
 *
 * Reducers must not mutate the document they are given: `apply` validates a
 * CANDIDATE and returns the original untouched if a rule rejects it, which
 * only works if producing the candidate left the original alone. */

/** A copy of `record` with `key` set. */
export const withKey = <T>(record: Readonly<Record<string, T>>, key: string, value: T) =>
  ({ ...record, [key]: value }) as Record<string, T>;

/** A copy of `record` without `key`. */
export function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest as Record<string, T>;
}

/** A copy of `record` with `key` renamed, keeping insertion order so a rename
 *  does not reshuffle the document and produce a noisy diff. */
export function renameKey<T>(
  record: Readonly<Record<string, T>>,
  from: string,
  to: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key === from ? to : key] = value;
  }
  return out;
}

/** A patch may name a key with `undefined` to CLEAR it. That has to be its own
 *  type: under `exactOptionalPropertyTypes`, `Partial<T>` means "absent", not
 *  "present and undefined", so the two cases are genuinely different. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** Merge a patch, dropping keys explicitly set to undefined so a command can
 *  clear an optional field rather than only ever setting one. */
export function patch<T extends object>(base: T, changes: Patch<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as T;
}

/** First id of the form `<prefix><n>` not already taken. */
export function freeId(taken: Readonly<Record<string, unknown>>, prefix: string): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!(id in taken)) return id;
  }
}

/** A patch that turns `after` back into `before`.
 *
 * A plain `Partial<before>` is NOT a correct inverse: merging it leaves any
 * key the change ADDED still present. Every such key has to be named
 * explicitly as `undefined` so the merge clears it. */
export function inversePatch<T extends object>(before: T, after: T): Patch<T> {
  const out = { ...before } as Record<string, unknown>;
  for (const key of Object.keys(after)) {
    if (!(key in before)) out[key] = undefined;
  }
  return out as Patch<T>;
}
