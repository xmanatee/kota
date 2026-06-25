import { McpManager } from "#core/mcp/manager.js";
import type {
  ModuleManifestSetupAvailabilitySnapshot,
} from "#core/modules/module-manifest.js";
import {
  listModuleSetupStatusesFromSummaries,
} from "#core/modules/module-setup-status.js";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import {
  getKnowledgeProvider,
} from "#core/modules/provider-registry.js";
import type {
  ModuleSetupCapabilityStatus,
  ModuleSetupRequirementStatus,
} from "#core/modules/setup-requirements.js";
import { getAllTools, getToolEffect } from "#core/tools/index.js";
import type { RecallHit, RecallSource } from "#modules/recall/client.js";
import { RECALL_PROVIDER_TOKEN, type RecallProvider } from "#modules/recall/recall-types.js";
import { listSkills } from "#modules/skill-ops/skill-ops-operations.js";
import type { ConfiguredMcpServerResource, ResourceDiscoverySnapshot } from "./catalog.js";
import type { ResourceDiscoveryFilter } from "./client.js";

const KNOWLEDGE_LIMIT = 20;
const RECALL_LIMIT = 20;
const RECALL_DISCOVERY_SOURCES = [
  "memory",
  "history",
  "tasks",
  "answer",
] satisfies ReadonlyArray<RecallSource>;

// Discovery is advisory: local setup status may be inspected, but live
// capability probes can refresh OAuth tokens or touch external services.
const ADVISORY_CAPABILITY_STATUSES: readonly ModuleSetupCapabilityStatus[] = [];

function setupAvailabilityFromStatus(
  status: ModuleSetupRequirementStatus,
): ModuleManifestSetupAvailabilitySnapshot {
  return {
    state: status.state,
    reason: status.reason,
    message: status.message,
    ...(status.capabilities !== undefined ? { capabilities: status.capabilities } : {}),
    ...(status.pendingAction !== undefined
      ? {
          pendingAction: {
            ...status.pendingAction,
            complete: `/setup/actions/${encodeURIComponent(status.pendingAction.actionId)}/complete`,
          },
        }
      : {}),
  };
}

function moduleSummariesWithAdvisoryAvailability(
  summaries: readonly ModuleSummary[],
  statuses: readonly ModuleSetupRequirementStatus[],
): ModuleSummary[] {
  const statusesByModule = new Map<string, ModuleSetupRequirementStatus[]>();
  for (const status of statuses) {
    const existing = statusesByModule.get(status.moduleName) ?? [];
    statusesByModule.set(status.moduleName, [...existing, status]);
  }
  return summaries.map((summary) => {
    if (!summary.manifest) return summary;
    const moduleStatuses = statusesByModule.get(summary.name) ?? [];
    const consumed = new Set<number>();
    return {
      ...summary,
      manifest: {
        ...summary.manifest,
        contributions: {
          ...summary.manifest.contributions,
          setupRequirements: summary.manifest.contributions.setupRequirements.map((req, index) => {
            const directIndex = moduleStatuses.findIndex((status, statusIndex) =>
              !consumed.has(statusIndex) && status.requirementId === req.id
            );
            // Client-safe setup status can redact credential-like ids; service
            // output preserves manifest order, so order is the safe fallback.
            const statusIndex = directIndex >= 0
              ? directIndex
              : index < moduleStatuses.length && !consumed.has(index)
                ? index
                : -1;
            const status = statusIndex >= 0 ? moduleStatuses[statusIndex] : undefined;
            if (!status) return req;
            consumed.add(statusIndex);
            return {
              ...req,
              availability: setupAvailabilityFromStatus(status),
            };
          }),
        },
      },
    };
  });
}

async function moduleSummariesWithAdvisorySetupStatus(ctx: ModuleContext) {
  const summaries = ctx.getModuleSummaries();
  const setupStatuses = await listModuleSetupStatusesFromSummaries({
    projectDir: ctx.cwd,
    getModuleSummaries: () => summaries,
    probeCapabilities: async () => ADVISORY_CAPABILITY_STATUSES,
  });
  return moduleSummariesWithAdvisoryAvailability(
    summaries,
    setupStatuses.requirements,
  );
}

export function configuredMcpServers(cwd: string): ConfiguredMcpServerResource[] {
  const config = McpManager.loadConfig(cwd);
  if (!config) return [];
  return Object.entries(config.mcpServers ?? {}).map(([name, serverConfig]) => {
    const transport = serverConfig.type === "http" ? "http" : serverConfig.type === "stdio" || serverConfig.type === undefined ? "stdio" : "invalid";
    return {
      name,
      transport,
      configPath: `.kota/mcp.json#mcpServers.${name}`,
      fields: Object.keys(serverConfig).sort(),
    };
  });
}

function knowledgeEntries(query: string) {
  try {
    return getKnowledgeProvider()
      .search(query, { scope: "all" })
      .slice(0, KNOWLEDGE_LIMIT);
  } catch {
    return [];
  }
}

async function recallHits(
  provider: RecallProvider | null,
  query: string,
  filter: ResourceDiscoveryFilter,
): Promise<RecallHit[]> {
  if (!provider) return [];
  try {
    return await provider.recall(query, {
      topK: RECALL_LIMIT,
      sources: RECALL_DISCOVERY_SOURCES,
      ...(filter.projectId !== undefined && { projectId: filter.projectId }),
      ...(filter.scopeId !== undefined && { scopeId: filter.scopeId }),
    });
  } catch {
    return [];
  }
}

export function buildResourceDiscoverySnapshotReader(ctx: ModuleContext) {
  return async (
    query: string,
    _filter: ResourceDiscoveryFilter,
  ): Promise<ResourceDiscoverySnapshot> => {
    const toolEffects = new Map(
      getAllTools()
        .map((tool) => [tool.name, getToolEffect(tool.name)] as const)
        .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof getToolEffect>>] =>
          entry[1] !== undefined
        ),
    );
    return {
      summaries: await moduleSummariesWithAdvisorySetupStatus(ctx),
      tools: getAllTools(),
      toolEffects,
      skillSummaries: listSkills(ctx).skills,
      knowledgeEntries: knowledgeEntries(query),
      recallHits: await recallHits(
        ctx.getProvider(RECALL_PROVIDER_TOKEN),
        query,
        _filter,
      ),
      mcpServers: configuredMcpServers(ctx.cwd),
    };
  };
}
