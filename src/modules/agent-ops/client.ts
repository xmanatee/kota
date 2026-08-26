/**
 * Agent-ops client contracts.
 *
 * The agent-ops module owns the `agents` KotaClient namespace end-to-end:
 * the per-agent summary shape, the list/inspect result envelopes, and the
 * `AgentsClient` interface itself. The aggregate `KotaClient` interface in
 * The generated KotaClient aggregate composes this contract by importing
 * `AgentsClient` from this module instead of declaring the shapes inline.
 *
 * The local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) both realize
 * `AgentsClient`; the `kota agent` CLI consumes them through
 * `ctx.client.agents`.
 */
import type {
  AgentToolPolicy,
  AgentWriteScope,
} from "#core/agents/agent-types.js";
import type { ModuleSource } from "#core/modules/module-types.js";
import type { ModuleSetupStatusState } from "#core/modules/setup-requirements.js";

export type AgentResolvedSkill = {
  name: string;
  source: string;
  promptPath: string;
  description?: string;
};

export type AgentToolPolicySummary = {
  posture:
    | "inherits-session"
    | "allow-list"
    | "deny-list"
    | "allow-list-with-deny-list";
  allowed?: string[];
  disallowed?: string[];
};

export type AgentSetupRequirementSummary = {
  id: string;
  kind: string;
  required: boolean;
  sensitivity: string;
  state: ModuleSetupStatusState;
  reason: string;
  message: string;
};

export type AgentWorkflowUsage = {
  workflow: string;
  stepId: string;
  harness?: string;
  autonomyMode?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

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
  moduleSource: ModuleSource;
  sourcePath?: string;
  sourcePaths: string[];
  role: string;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  promptPath: string;
  writeScope: AgentWriteScope;
  skills?: string[] | "all";
  resolvedSkills: AgentResolvedSkill[];
  tools?: AgentToolPolicy;
  toolPolicy: AgentToolPolicySummary;
  workflows: string[];
  workflowUsages: AgentWorkflowUsage[];
  channels: string[];
  setupRequirements: AgentSetupRequirementSummary[];
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
