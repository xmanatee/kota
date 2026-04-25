/**
 * Shared read logic for `kota agent list` / `kota agent inspect`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  AgentInspectResult,
  AgentSummary,
  AgentsListResult,
} from "#core/server/kota-client.js";

/**
 * Build the resolved per-source agent list.
 *
 * `config.agentModels` overrides take precedence over the agent's declared
 * model. Duplicates across modules are dropped — the first contributor wins,
 * matching the loader's "first declaration wins" policy.
 */
export function listAgents(ctx: ModuleContext): AgentsListResult {
  const overrides = ctx.config.agentModels ?? {};
  const summaries = ctx.getModuleSummaries();
  const agents: AgentSummary[] = [];

  for (const summary of summaries) {
    for (const agent of summary.agents) {
      if (agents.some((entry) => entry.name === agent.name)) continue;
      agents.push({
        name: agent.name,
        source: summary.name,
        role: agent.role,
        model: overrides[agent.name] ?? agent.model,
        ...(agent.effort !== undefined && { effort: agent.effort }),
        promptPath: agent.promptPath,
        writeScope: agent.writeScope,
        ...(agent.skills !== undefined && { skills: agent.skills }),
        ...(agent.tools !== undefined && { tools: agent.tools }),
      });
    }
  }

  return { agents };
}

export function inspectAgent(
  ctx: ModuleContext,
  name: string,
): AgentInspectResult {
  const { agents } = listAgents(ctx);
  const found = agents.find((entry) => entry.name === name);
  if (!found) return { found: false };
  return { found: true, agent: found };
}
