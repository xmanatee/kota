import { resolve } from "node:path";

export const SCOPE_ROOT_ENV_VAR = "KOTA_SCOPE_ROOT";

/**
 * Resolve the absolute scope root that KOTA should operate on.
 *
 * Precedence:
 *   1. Explicit `override` (e.g. a CLI flag).
 *   2. `KOTA_SCOPE_ROOT` environment variable.
 *   3. `process.cwd()`.
 *
 * The selected path is always returned as an absolute path so callers can
 * treat it as the authoritative scope root without re-resolving.
 */
export function resolveScopeRoot(override?: string): string {
  const raw = override ?? process.env[SCOPE_ROOT_ENV_VAR] ?? process.cwd();
  return resolve(raw);
}
