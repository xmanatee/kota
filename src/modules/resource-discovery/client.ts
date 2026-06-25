import type {
  ModuleManifestSetupStatusLinks,
} from "#core/modules/module-manifest.js";
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";
import type { RiskTier, ToolEffect } from "#core/tools/effect.js";

export const RESOURCE_DISCOVERY_KINDS = [
  "tool",
  "skill",
  "agent",
  "workflow",
  "module",
  "channel",
  "mcp-server",
  "setup-requirement",
  "knowledge-entry",
  "recall-hit",
] as const;

export type ResourceDiscoveryKind = (typeof RESOURCE_DISCOVERY_KINDS)[number];

export type ResourceDiscoverySetupBlocker = {
  moduleName: string;
  requirementId: string;
  title: string;
  state: string;
  reason: string;
  message: string;
  statusLinks: ModuleManifestSetupStatusLinks;
};

export type ResourceDiscoveryReadiness =
  | { status: "ready"; message: string }
  | { status: "read_only"; message: string }
  | {
      status: "setup_blocked";
      message: string;
      blockers: readonly ResourceDiscoverySetupBlocker[];
    }
  | { status: "unavailable"; reason: string; message: string };

export type ResourceDiscoveryRisk = {
  effect: ToolEffect;
  risk: RiskTier;
};

export type ResourceDiscoveryHit = {
  kind: ResourceDiscoveryKind;
  id: string;
  name: string;
  title: string;
  description: string;
  score: number;
  why: readonly string[];
  readiness: ResourceDiscoveryReadiness;
  ownerModule: string;
  inspectPath: string;
  accessHint: string;
  tags: readonly string[];
  risk?: ResourceDiscoveryRisk;
  metadata: Readonly<Record<string, string | number | boolean>>;
};

export type ResourceDiscoveryFilter = ScopeSelector & {
  limit?: number;
  minScore?: number;
  kinds?: ReadonlyArray<ResourceDiscoveryKind>;
  includeUnavailable?: boolean;
};

export type ResourceDiscoveryResult =
  | {
      ok: true;
      query: string;
      hits: readonly ResourceDiscoveryHit[];
      degradation: "keyword_only";
    }
  | { ok: false; reason: "empty_query"; message: string };

export interface ResourceDiscoveryClient {
  discover(
    query: string,
    filter?: ResourceDiscoveryFilter,
  ): Promise<ResourceDiscoveryResult>;
}

export interface ResourceDiscoveryProvider extends ResourceDiscoveryClient {}

export const RESOURCE_DISCOVERY_PROVIDER_TOKEN: ProviderToken<ResourceDiscoveryProvider> =
  defineProviderToken<ResourceDiscoveryProvider>("resource-discovery");
