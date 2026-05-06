/**
 * Typed dot-path traversal helpers for `KotaConfig`.
 *
 * The CLI surface in `config-operations.ts` reads dot-notation keys
 * (`a.b.c`) into the resolved merged config and writes single- or
 * two-segment keys back to the project-level draft. Both operations need
 * to walk a typed config as a string-keyed record. This module owns that
 * widening in one named place — `asConfigRecord` — so call sites stay
 * cast-free and the strict-types-policy boundary stays auditable.
 *
 * `setConfigPath` preserves the existing two-segment-max contract of
 * `setConfigValue`: a single segment replaces the top-level entry; a
 * multi-segment key writes `parts[1]` into the nested object under
 * `parts[0]`, creating a fresh object when the existing slot is absent
 * or non-object. Segments beyond `parts[1]` are ignored, matching the
 * behavior of the previous inline implementation.
 */

import type { KotaConfig } from "#core/config/config.js";

export type ConfigPathLookup =
  | { found: true; value: unknown }
  | { found: false; reason: "not_found" };

function asConfigRecord(
  config: KotaConfig | Partial<KotaConfig>,
): Record<string, unknown> {
  return config as unknown as Record<string, unknown>;
}

export function getConfigPath(
  config: KotaConfig,
  parts: readonly string[],
): ConfigPathLookup {
  let current: unknown = asConfigRecord(config);
  for (const part of parts) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return { found: false, reason: "not_found" };
    }
    const record = current as Record<string, unknown>;
    if (!(part in record)) {
      return { found: false, reason: "not_found" };
    }
    current = record[part];
  }
  return { found: true, value: current };
}

export function setConfigPath(
  draft: Partial<KotaConfig>,
  parts: readonly [string, ...string[]],
  value: unknown,
): Partial<KotaConfig> {
  const record = asConfigRecord(draft);
  const head = parts[0];
  if (parts.length === 1) {
    return { ...record, [head]: value } as Partial<KotaConfig>;
  }
  const existing = record[head];
  const nested: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  nested[parts[1]] = value;
  return { ...record, [head]: nested } as Partial<KotaConfig>;
}

/**
 * Public `Record<string, unknown>` view of a resolved `KotaConfig`. The
 * `ConfigValidateResult.resolved` contract types this as a JSON record so
 * the CLI can round-trip it without learning module-specific shapes; the
 * widening lives here so the call site does not re-launder the type.
 */
export function asResolvedConfigView(
  config: KotaConfig,
): Record<string, unknown> {
  return asConfigRecord(config);
}
