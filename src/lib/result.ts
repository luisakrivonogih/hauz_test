/**
 * Server functions return this instead of throwing for expected outcomes
 * (bad input, already-exists, upstream failure). Custom Error subclasses
 * don't reliably survive the client/server RPC boundary TanStack Start
 * server functions cross, so callers can't do `instanceof` checks on a
 * thrown error after the round-trip — a plain discriminated result can
 * always be read safely on either side.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'validation'; issues: Array<{ path: string; message: string }>; message?: string }
  | { ok: false; kind: 'conflict'; message: string }
  | { ok: false; kind: 'external'; message: string }

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function validationError(
  issues: Array<{ path: string; message: string }>,
  message?: string,
): ActionResult<never> {
  return { ok: false, kind: 'validation', issues, message }
}

export function conflictError(message: string): ActionResult<never> {
  return { ok: false, kind: 'conflict', message }
}

export function externalError(message: string): ActionResult<never> {
  return { ok: false, kind: 'external', message }
}
