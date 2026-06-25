import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type { RecallHit } from "#modules/recall/client.js";
import type { SkillSummary } from "#modules/skill-ops/client.js";
import type {
  ResourceDiscoveryHit,
} from "./client.js";

export type ConfiguredMcpServerResource = {
  name: string;
  transport: "stdio" | "http" | "invalid";
  configPath: string;
  fields: readonly string[];
};

export type ResourceDiscoverySnapshot = {
  summaries: readonly ModuleSummary[];
  tools: readonly KotaTool[];
  toolEffects: ReadonlyMap<string, ToolEffect>;
  skillSummaries: readonly SkillSummary[];
  knowledgeEntries: readonly KnowledgeEntry[];
  recallHits: readonly RecallHit[];
  mcpServers: readonly ConfiguredMcpServerResource[];
};

export type ResourceDiscoverySearchField = {
  label: string;
  text: string;
  weight: number;
};

export type ResourceDiscoveryCandidate = {
  hit: Omit<ResourceDiscoveryHit, "score" | "why">;
  fields: readonly ResourceDiscoverySearchField[];
};
