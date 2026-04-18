import { resolve } from "node:path";

export const PROJECT_DIR_ENV_VAR = "KOTA_PROJECT_DIR";

/**
 * Resolve the absolute project directory that KOTA should operate on.
 *
 * Precedence:
 *   1. Explicit `override` (e.g. a CLI flag).
 *   2. `KOTA_PROJECT_DIR` environment variable.
 *   3. `process.cwd()`.
 *
 * The selected path is always returned as an absolute path so callers can
 * treat it as the authoritative project root without re-resolving.
 */
export function resolveProjectDir(override?: string): string {
  const raw = override ?? process.env[PROJECT_DIR_ENV_VAR] ?? process.cwd();
  return resolve(raw);
}
