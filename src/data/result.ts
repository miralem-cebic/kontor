// Results instead of exceptions for the storage layer: a failure is a value, and the caller has to look at it.
// Exceptions are still thrown inside the browser API; FsRepository turns them into results at its boundary.

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** For the places that want exceptions again (startup, maintenance): turns a failed result into a thrown error. */
export function must<T, E extends { cause?: unknown; kind?: string }>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  if (r.error.cause instanceof Error) throw r.error.cause;
  throw new Error(`Storage error: ${r.error.kind ?? 'unknown'}`);
}
