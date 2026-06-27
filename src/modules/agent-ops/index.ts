/**
 * Agent ops module — owns the `kota agent` inspection surface.
 *
 * Agent definitions are contributed by loaded modules. This module does not
 * maintain a separate registry; it reflects whatever the current module set
 * provides.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  type ColumnsNode,
  columns,
  type KVEntry,
  kvBlock,
  line,
  plain,
  span,
} from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson } from "#modules/rendering/transport.js";
import { inspectAgent, listAgents } from "./agent-ops-operations.js";
import type {
  AgentInspectResult,
  AgentSetupRequirementSummary,
  AgentSummary,
  AgentsClient,
  AgentsListResult,
  AgentToolPolicySummary,
} from "./client.js";
import { agentControlRoutes } from "./routes.js";

function buildAgentCommand(ctx: ModuleContext): Command {
  const agentCmd = new Command("agent").description("Inspect available agents");

  agentCmd
    .command("list")
    .description("List all contributed agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.agents.list();
      if (opts.json) {
        writeJson(result.agents, { pretty: true });
        return;
      }
      if (result.agents.length === 0) {
        print(line(plain("No agents available.")));
        return;
      }
      print(buildAgentListNode(result.agents));
    });

  agentCmd
    .command("inspect <name>")
    .description("Show full detail for one agent")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const result = await ctx.client.agents.inspect(name);
      if (!result.found) {
        const all = await ctx.client.agents.list();
        const names = all.agents.map((entry) => entry.name).join(", ");
        printToStderr(line(span(`Agent "${name}" not found. Registered: ${names || "(none)"}`, "error")));
        process.exit(1);
      }
      if (opts.json) {
        writeJson(result.agent, { pretty: true });
        return;
      }
      print(kvBlock(buildAgentInspectEntries(result.agent)));
    });

  return agentCmd;
}

export function buildAgentListNode(agents: AgentSummary[]): ColumnsNode {
  return columns(
    [
      { header: "Name", role: "accent" },
      { header: "Model", role: "info" },
      { header: "Source", role: "muted" },
      { header: "Role", maxWidth: 60 },
    ],
    agents.map((agent) => ({
      cells: [
        { spans: [{ text: agent.name, role: "accent" }] },
        { spans: [{ text: agent.model, role: "info" }] },
        { spans: [{ text: agent.source, role: "muted" }] },
        { spans: [{ text: agent.role }] },
      ],
    })),
  );
}

export function buildAgentInspectEntries(agent: AgentSummary): KVEntry[] {
  const entries: KVEntry[] = [
    { label: "Name", value: agent.name, role: "accent" },
    { label: "Source", value: agent.source, role: "muted" },
    { label: "Module Source", value: agent.moduleSource, role: "muted" },
    { label: "Role", value: agent.role, role: "info" },
  ];
  if (agent.model) entries.push({ label: "Model", value: agent.model, role: "info" });
  if (agent.effort) entries.push({ label: "Effort", value: agent.effort, role: "info" });
  entries.push({ label: "Prompt", value: agent.promptPath, role: "muted" });
  if (agent.sourcePaths.length > 0) {
    entries.push({ label: "Source Files", value: agent.sourcePaths.join(", "), role: "muted" });
  }
  const skillDisplay = formatSkills(agent);
  if (skillDisplay !== null) {
    entries.push({ label: "Skills", value: skillDisplay, role: "muted" });
  }
  entries.push({ label: "Tool Policy", value: formatToolPolicy(agent.toolPolicy), role: "muted" });
  if (agent.workflows.length > 0) {
    entries.push({ label: "Workflows", value: agent.workflows.join(", "), role: "muted" });
  }
  if (agent.workflowUsages.length > 0) {
    entries.push({
      label: "Workflow Steps",
      value: agent.workflowUsages.map((usage) => {
        const detail = [
          usage.harness ? `harness=${usage.harness}` : null,
          usage.autonomyMode ? `autonomy=${usage.autonomyMode}` : null,
          usage.effort ? `effort=${usage.effort}` : null,
        ].filter((part): part is string => part !== null);
        return detail.length === 0
          ? `${usage.workflow}.${usage.stepId}`
          : `${usage.workflow}.${usage.stepId} (${detail.join(", ")})`;
      }).join(", "),
      role: "muted",
    });
  }
  if (agent.channels.length > 0) {
    entries.push({ label: "Channels", value: agent.channels.join(", "), role: "muted" });
  }
  entries.push({
    label: "Setup",
    value: formatSetupRequirements(agent.setupRequirements),
    role: setupRole(agent.setupRequirements),
  });
  entries.push({
    label: "WriteScope",
    value: agent.writeScope.length === 0 ? "<unrestricted>" : agent.writeScope.join(", "),
    role: "muted",
  });
  if (agent.toolPolicy.allowed) {
    entries.push({ label: "Allowed", value: agent.toolPolicy.allowed.join(", "), role: "success" });
  }
  if (agent.toolPolicy.disallowed) {
    entries.push({ label: "Blocked", value: agent.toolPolicy.disallowed.join(", "), role: "error" });
  }
  return entries;
}

function formatSkills(agent: AgentSummary): string | null {
  if (agent.resolvedSkills.length > 0) {
    return agent.resolvedSkills
      .map((skill) => `${skill.name} (${skill.promptPath})`)
      .join(", ");
  }
  if (agent.skills) {
    const display = agent.skills === "all" ? "all (none resolved)" : agent.skills.join(", ");
    return display;
  }
  return null;
}

function formatToolPolicy(policy: AgentToolPolicySummary): string {
  switch (policy.posture) {
    case "inherits-session":
      return "inherits session/tool-runner policy";
    case "allow-list":
      return "allow-list";
    case "deny-list":
      return "deny-list";
    case "allow-list-with-deny-list":
      return "allow-list with deny-list";
  }
}

function setupRole(
  requirements: readonly AgentSetupRequirementSummary[],
): "muted" | "success" | "warn" {
  if (requirements.length === 0) return "muted";
  if (requirements.some((requirement) =>
    requirement.required && requirement.state !== "ready"
  )) {
    return "warn";
  }
  return "success";
}

function formatSetupRequirements(
  requirements: readonly AgentSetupRequirementSummary[],
): string {
  if (requirements.length === 0) return "<none>";
  return requirements
    .map((requirement) => {
      const requirementKind = requirement.required ? "required" : "optional";
      return `${requirement.id} ${requirement.state} (${requirementKind}): ${requirement.message}`;
    })
    .join(", ");
}

const agentsModule: KotaModule = {
  name: "agent-ops",
  version: "1.0.0",
  description: "Operator CLI for inspecting contributed agents",
  dependencies: ["rendering"],
  commands: (ctx: ModuleContext) => [buildAgentCommand(ctx)],
  controlRoutes: (ctx) => agentControlRoutes(ctx),
  localClient: (ctx) => {
    const agents: AgentsClient = {
      async list() {
        return listAgents(ctx);
      },
      async inspect(name) {
        return inspectAgent(ctx, name);
      },
    };
    return { agents };
  },

  daemonClient: (link: DaemonTransport) => ({
    agents: buildAgentsDaemonHandler(link),
  }),
};

/**
 * Daemon-side `AgentsClient` backed by the typed `DaemonTransport`. Both
 * methods issue a single strict GET against the routes the agent-ops module
 * registers through `controlRoutes` and decode the canonical envelope the
 * daemon emits — no special-cased status translation, matching every other
 * migrated namespace's strict-transport posture.
 */
function buildAgentsDaemonHandler(link: DaemonTransport): AgentsClient {
  return {
    list: async (): Promise<AgentsListResult> =>
      link.requestStrict<AgentsListResult>("GET", "/agents"),
    inspect: async (name): Promise<AgentInspectResult> =>
      link.requestStrict<AgentInspectResult>(
        "GET",
        `/agents/${encodeURIComponent(name)}`,
      ),
  };
}

export default agentsModule;
