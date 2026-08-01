import type { ScopeLifecycleBlockerKind } from "#core/events/event-bus-types.js";
import {
  defineProviderToken,
  type ProviderRegistry,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { ConfiguredProject } from "./scope-registry.js";

export type ScopeDrainDisposition =
  | "select-another-default"
  | "wait-or-abort"
  | "close"
  | "resolve-or-reject"
  | "cancel-or-complete"
  | "deliver-event"
  | "deliver-or-timeout"
  | "release-or-supersede"
  | "release"
  | "repair-inspection";

export type ScopeDrainBlocker = {
  kind: ScopeLifecycleBlockerKind;
  source: string;
  count: number;
  ids: string[];
  requiredDisposition: ScopeDrainDisposition;
  detail: string;
};

export type ScopeExternalDrainBlocker = ScopeDrainBlocker & {
  kind: "task_claim" | "pending_work" | "resource_lease";
};

export interface ScopeDrainInspectionSource {
  inspect(project: ConfiguredProject): readonly ScopeExternalDrainBlocker[];
}

export const SCOPE_DRAIN_INSPECTION_PROVIDER_TYPE: ProviderToken<ScopeDrainInspectionSource> =
  defineProviderToken<ScopeDrainInspectionSource>("scope-drain-inspection");

export function inspectExternalScopeDrainBlockers(
  registry: ProviderRegistry | null,
  project: ConfiguredProject,
): ScopeDrainBlocker[] {
  if (registry === null) return [];
  const blockers: ScopeDrainBlocker[] = [];
  for (const name of registry.list(SCOPE_DRAIN_INSPECTION_PROVIDER_TYPE)) {
    const source = registry.getByName(SCOPE_DRAIN_INSPECTION_PROVIDER_TYPE, name);
    if (source === null) continue;
    try {
      blockers.push(...source.inspect(project));
    } catch (error) {
      blockers.push({
        kind: "inspection_failure",
        source: name,
        count: 1,
        ids: [],
        requiredDisposition: "repair-inspection",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return blockers;
}
