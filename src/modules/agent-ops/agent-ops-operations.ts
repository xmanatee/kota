/**
 * Shared read logic for `kota agent list` / `kota agent inspect`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import type { AgentToolPolicy } from "#core/agents/agent-types.js";
import { probeCapabilityReadiness } from "#core/daemon/capability-readiness.js";
import {
  listModuleSetupStatusesFromSummaries,
  moduleSummariesWithSetupAvailability,
} from "#core/modules/module-setup-status.js";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type {
  AgentInspectResult,
  AgentResolvedSkill,
  AgentSetupRequirementSummary,
  AgentSummary,
  AgentsListResult,
  AgentToolPolicySummary,
  AgentWorkflowUsage,
} from "./client.js";

async function probeSetupCapabilities() {
  const registry = getProviderRegistry();
  if (!registry) return [];
  const response = await probeCapabilityReadiness(registry);
  return response.capabilities;
}

async function moduleSummariesWithCurrentSetupAvailability(
  ctx: ModuleContext,
): Promise<readonly ModuleSummary[]> {
  const summaries = ctx.getModuleSummaries();
  if (
    summaries.every((summary) =>
      (summary.manifest?.contributions.setupRequirements.length ?? 0) === 0
    )
  ) {
    return summaries;
  }
  const statuses = await listModuleSetupStatusesFromSummaries({
    projectDir: ctx.cwd,
    getModuleSummaries: () => summaries,
    probeCapabilities: probeSetupCapabilities,
  });
  return moduleSummariesWithSetupAvailability(summaries, statuses.requirements);
}

function moduleSourcePath(summary: ModuleSummary): string | undefined {
  switch (summary.source) {
    case "project":
      return `src/modules/${summary.name}`;
    case "installed":
      return `.kota/modules/${summary.name}`;
    case "foreign":
      return undefined;
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function summarizeToolPolicy(
  tools: AgentToolPolicy | undefined,
): AgentToolPolicySummary {
  const allowed = tools?.allowed ? uniqueSorted(tools.allowed) : undefined;
  const disallowed = tools?.disallowed ? uniqueSorted(tools.disallowed) : undefined;
  if (allowed && disallowed && disallowed.length > 0) {
    return { posture: "allow-list-with-deny-list", allowed, disallowed };
  }
  if (allowed) return { posture: "allow-list", allowed };
  if (disallowed && disallowed.length > 0) return { posture: "deny-list", disallowed };
  return { posture: "inherits-session" };
}

function skillAppliesToAgent(
  agent: ModuleSummary["agents"][number],
  skill: ModuleSummary["skills"][number],
): boolean {
  if (agent.skills === undefined) return false;
  if (agent.skills !== "all") return agent.skills.includes(skill.name);
  return skill.roles === undefined ||
    skill.roles.length === 0 ||
    skill.roles.includes(agent.name);
}

function resolveAgentSkills(
  summaries: readonly ModuleSummary[],
  agent: ModuleSummary["agents"][number],
): AgentResolvedSkill[] {
  return summaries.flatMap((summary) =>
    summary.skills
      .filter((skill) => skillAppliesToAgent(agent, skill))
      .map((skill) => ({
        name: skill.name,
        source: summary.name,
        promptPath: skill.promptPath,
        ...(skill.description !== undefined && { description: skill.description }),
      }))
  );
}

function summarizeSetupRequirements(
  summary: ModuleSummary,
): AgentSetupRequirementSummary[] {
  return (summary.manifest?.contributions.setupRequirements ?? []).map((requirement) => ({
    id: requirement.id,
    kind: requirement.kind,
    required: requirement.required,
    sensitivity: requirement.sensitivity,
    state: requirement.availability?.state ?? "unknown",
    reason: requirement.availability?.reason ?? "not_evaluated",
    message: requirement.availability?.message ??
      "Setup status was not evaluated for this inspection.",
  }));
}

function usageFromAgentStep(args: {
  workflow: RegisteredWorkflowDefinitionInput;
  step: WorkflowAgentStepInput;
}): AgentWorkflowUsage {
  const autonomyMode = args.step.autonomyMode ?? args.workflow.defaultAutonomyMode;
  return {
    workflow: args.workflow.name,
    stepId: args.step.id,
    ...(args.step.harness !== undefined && { harness: args.step.harness }),
    ...(autonomyMode !== undefined && { autonomyMode }),
    ...(args.step.model !== undefined && { model: args.step.model }),
    ...(args.step.effort !== undefined && { effort: args.step.effort }),
  };
}

function collectAgentWorkflowUsages(
  workflows: readonly RegisteredWorkflowDefinitionInput[],
  agentName: string,
): AgentWorkflowUsage[] {
  const usages: AgentWorkflowUsage[] = [];
  const visit = (
    workflow: RegisteredWorkflowDefinitionInput,
    steps: readonly WorkflowStepInput[],
  ) => {
    for (const step of steps) {
      switch (step.type) {
        case "agent":
          if (step.agentName === agentName) {
            usages.push(usageFromAgentStep({ workflow, step }));
          }
          break;
        case "parallel":
        case "foreach":
          visit(workflow, step.steps);
          break;
        case "branch":
          visit(workflow, step.ifTrue);
          visit(workflow, step.ifFalse ?? []);
          break;
        case "tool":
        case "emit":
        case "restart":
        case "code":
        case "trigger":
        case "approval":
        case "await-event":
          break;
      }
    }
  };
  for (const workflow of workflows) visit(workflow, workflow.steps);
  return usages;
}

/**
 * Build the resolved per-source agent list.
 *
 * `config.agentModels` overrides take precedence over the agent's declared
 * model. Duplicates across modules are dropped — the first contributor wins,
 * matching the loader's "first declaration wins" policy.
 */
export function listAgentsFromSummaries(
  summaries: readonly ModuleSummary[],
  overrides: Record<string, string> = {},
  workflows: readonly RegisteredWorkflowDefinitionInput[] = [],
): AgentsListResult {
  const agents: AgentSummary[] = [];

  for (const summary of summaries) {
    for (const agent of summary.agents) {
      if (agents.some((entry) => entry.name === agent.name)) continue;
      const resolvedSkills = resolveAgentSkills(summaries, agent);
      const sourcePath = moduleSourcePath(summary);
      const sourcePaths = uniqueInOrder([
        ...(sourcePath !== undefined ? [sourcePath] : []),
        agent.promptPath,
        ...resolvedSkills.map((skill) => skill.promptPath),
      ]);
      const workflowUsages = collectAgentWorkflowUsages(workflows, agent.name);
      agents.push({
        name: agent.name,
        source: summary.name,
        moduleSource: summary.source,
        ...(sourcePath !== undefined && { sourcePath }),
        sourcePaths,
        role: agent.role,
        model: overrides[agent.name] ?? agent.model,
        ...(agent.effort !== undefined && { effort: agent.effort }),
        promptPath: agent.promptPath,
        writeScope: agent.writeScope,
        ...(agent.skills !== undefined && { skills: agent.skills }),
        resolvedSkills,
        ...(agent.tools !== undefined && { tools: agent.tools }),
        toolPolicy: summarizeToolPolicy(agent.tools),
        workflows: [...summary.workflowNames],
        workflowUsages,
        channels: [...summary.channelNames],
        setupRequirements: summarizeSetupRequirements(summary),
      });
    }
  }

  return { agents };
}

export async function listAgents(ctx: ModuleContext): Promise<AgentsListResult> {
  const summaries = await moduleSummariesWithCurrentSetupAvailability(ctx);
  return listAgentsFromSummaries(
    summaries,
    ctx.config.agentModels ?? {},
    ctx.getContributedWorkflows(),
  );
}

export async function inspectAgent(
  ctx: ModuleContext,
  name: string,
): Promise<AgentInspectResult> {
  const { agents } = await listAgents(ctx);
  const found = agents.find((entry) => entry.name === name);
  if (!found) return { found: false };
  return { found: true, agent: found };
}
