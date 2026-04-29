/**
 * Capability readiness — typed contract thin clients use to decide which
 * operator capabilities are usable before rendering controls.
 *
 * Each provider-backed module contributes one
 * {@link CapabilityReadinessSource} through the provider-registry seam
 * using the typed `CAPABILITY_READINESS_PROVIDER_TYPE` token. The daemon
 * aggregates every registered source into a stable typed response served
 * by `GET /capabilities`. Clients consume the same shape locally
 * (`probeCapabilityReadiness()`) when no daemon is running, so daemon-up
 * and daemon-down operators see one contract.
 *
 * The seam lives next to the daemon-control types because the response
 * shape is part of the daemon's read-scope contract; the registration is
 * still module-owned and lives in each contributing module's `onLoad`.
 */

import type { ProviderRegistry } from "#core/modules/provider-registry.js";
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";

/**
 * Status of a single capability.
 *
 * - `ready`: the capability is usable right now.
 * - `unavailable`: the capability is intentionally not usable in this
 *   project (e.g. embedding-backed search without an embedding provider).
 *   Clients should disable, hide, or explain the control rather than
 *   surfacing it as a generic route failure.
 * - `init_failed`: the readiness probe itself threw — treat as a hard
 *   failure that needs operator attention.
 */
export type CapabilityStatus = "ready" | "unavailable" | "init_failed";

/**
 * Readiness report for a single capability.
 *
 * `id` is the stable operator-facing identifier (e.g. `"knowledge.search"`,
 * `"knowledge.semantic_search"`, `"workflow.trigger"`). It must be unique
 * across all contributing modules — duplicate ids fail loudly during
 * aggregation.
 *
 * `reason` is a stable machine-readable code (e.g. `"no_provider"`,
 * `"embedding_unsupported"`, `"no_contributors"`) that thin clients can
 * map to UI without reading `message`. `message` is short operator-facing
 * text suitable for surfacing in a popover or doctor report.
 *
 * `meta` carries small typed extras (URLs, counts, definition names) that
 * a client may render alongside the readiness state.
 */
export type CapabilityReadiness = {
  id: string;
  moduleName: string;
  status: CapabilityStatus;
  reason?: string;
  message?: string;
  meta?: Record<string, string | number | boolean>;
};

/**
 * One source of capability-readiness reports. Each provider-backed module
 * registers a single source describing the capabilities it owns. Sources
 * may report multiple capabilities — an embedding-aware search module
 * typically reports both keyword and semantic readiness.
 */
export type CapabilityReadinessSource = {
  /** Originating module name (used for tagging and error reporting). */
  moduleName: string;
  /** Probe every capability owned by this module. Sync or async. */
  probe(): CapabilityReadiness[] | Promise<CapabilityReadiness[]>;
};

/** Provider-registry token for capability-readiness sources. */
export const CAPABILITY_READINESS_PROVIDER_TYPE: ProviderToken<CapabilityReadinessSource> =
  defineProviderToken<CapabilityReadinessSource>("capability-readiness");

export type CapabilityReadinessSummary = {
  ready: number;
  unavailable: number;
  init_failed: number;
};

export type CapabilityReadinessResponse = {
  capabilities: CapabilityReadiness[];
  summary: CapabilityReadinessSummary;
};

/**
 * Aggregate every registered capability-readiness source into one typed
 * response. Sources that throw during probing are surfaced as a single
 * `init_failed` entry tagged with the module name, so a buggy contributor
 * cannot hide the rest of the report.
 *
 * The response is sorted by `id` for deterministic client rendering and
 * deduplication: a duplicate `id` from two sources is collapsed into one
 * `init_failed` row that names both modules — this makes wiring conflicts
 * loud and discoverable instead of letting the second registration win
 * silently.
 */
export async function probeCapabilityReadiness(
  registry: ProviderRegistry,
): Promise<CapabilityReadinessResponse> {
  const sourceNames = registry.list(CAPABILITY_READINESS_PROVIDER_TYPE);
  const collected: CapabilityReadiness[] = [];
  for (const name of sourceNames) {
    const source = registry.getByName(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      name,
    );
    if (!source) continue;
    try {
      const reports = await source.probe();
      for (const report of reports) collected.push(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      collected.push({
        id: `${source.moduleName}.__probe__`,
        moduleName: source.moduleName,
        status: "init_failed",
        reason: "probe_threw",
        message: `capability-readiness probe threw: ${message}`,
      });
    }
  }

  const byId = new Map<string, CapabilityReadiness>();
  for (const entry of collected) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    byId.set(entry.id, {
      id: entry.id,
      moduleName: `${existing.moduleName}+${entry.moduleName}`,
      status: "init_failed",
      reason: "duplicate_id",
      message:
        `capability id "${entry.id}" registered by both ` +
        `${existing.moduleName} and ${entry.moduleName}`,
    });
  }

  const capabilities = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const summary: CapabilityReadinessSummary = {
    ready: 0,
    unavailable: 0,
    init_failed: 0,
  };
  for (const cap of capabilities) summary[cap.status] += 1;
  return { capabilities, summary };
}
