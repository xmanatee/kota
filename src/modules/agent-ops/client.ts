/**
 * Agent-ops client contracts.
 *
 * The agent-ops module owns the `agents` KotaClient namespace end-to-end:
 * the per-agent summary shape, the list/inspect result envelopes, and the
 * `AgentsClient` interface itself. The aggregate `KotaClient` interface in
 * `src/core/server/kota-client.ts` composes this contract by importing
 * `AgentsClient` from this module instead of declaring the shapes inline.
 *
 * The local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) both realize
 * `AgentsClient`; the `kota agent` CLI consumes them through
 * `ctx.client.agents`.
 */
import type { AgentToolPolicy } from "#core/agents/agent-types.js";

/**
 * Per-agent summary surfaced by `agents.list` / `agents.inspect`.
 *
 * `source` carries the contributing module name so the navigator can render
 * attribution. `model` reflects the agent's default after operator overrides
 * from `config.agentModels` are applied — the contract pre-resolves that
 * mapping so no caller has to repeat it. `effort` is required on every
 * `AgentDef`, but the contract types it as optional because some legacy
 * agent definitions surfaced through `getModuleSummaries()` predate the
 * required field; absence renders as the empty string in CLI output.
 */
export type AgentSummary = {
  name: string;
  source: string;
  role: string;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  promptPath: string;
  writeScope: string[];
  skills?: string[] | "all";
  tools?: AgentToolPolicy;
};

export type AgentsListResult = {
  agents: AgentSummary[];
};

export type AgentInspectResult =
  | { found: true; agent: AgentSummary }
  | { found: false };

/**
 * Agent definition operations.
 *
 * `list` returns every agent contributed by the loaded module set, with the
 * operator's `agentModels` overrides already resolved. `inspect` returns the
 * full detail for a single agent. Both reads work daemon-up and daemon-down;
 * the daemon-side route reflects the daemon's loaded module set, the local
 * handler reflects the CLI's.
 */
export interface AgentsClient {
  list(): Promise<AgentsListResult>;
  inspect(name: string): Promise<AgentInspectResult>;
}
