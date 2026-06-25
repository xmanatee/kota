import type { ModuleSummary } from "#core/modules/module-types.js";
import {
  agentCandidates,
  moduleCandidates,
  skillCandidates,
  toolCandidates,
} from "./catalog-owned-candidates.js";
import {
  channelCandidates,
  knowledgeCandidates,
  mcpCandidates,
  recallCandidates,
  setupCandidates,
  workflowCandidates,
} from "./catalog-runtime-candidates.js";
import type {
  ResourceDiscoveryCandidate,
  ResourceDiscoverySnapshot,
} from "./catalog-types.js";

export type {
  ConfiguredMcpServerResource,
  ResourceDiscoveryCandidate,
  ResourceDiscoverySnapshot,
} from "./catalog-types.js";

export function buildResourceDiscoveryCandidates(
  snapshot: ResourceDiscoverySnapshot,
): ResourceDiscoveryCandidate[] {
  const summariesByModule = new Map(snapshot.summaries.map((summary) => [summary.name, summary]));
  const toolOwners = new Map<string, ModuleSummary>();
  for (const summary of snapshot.summaries) {
    for (const toolName of summary.toolNames) toolOwners.set(toolName, summary);
  }
  return [
    ...moduleCandidates(snapshot.summaries),
    ...toolCandidates(snapshot.tools, snapshot.toolEffects, toolOwners),
    ...skillCandidates(snapshot.skillSummaries, summariesByModule),
    ...agentCandidates(snapshot.summaries),
    ...workflowCandidates(snapshot.summaries),
    ...channelCandidates(snapshot.summaries),
    ...setupCandidates(snapshot.summaries),
    ...mcpCandidates(snapshot.mcpServers, summariesByModule.get("mcp-registry")),
    ...knowledgeCandidates(snapshot.knowledgeEntries),
    ...recallCandidates(snapshot.recallHits),
  ];
}
