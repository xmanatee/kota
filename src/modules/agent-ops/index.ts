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
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { inspectAgent, listAgents } from "./agent-ops-operations.js";
import type {
  AgentInspectResult,
  AgentSummary,
  AgentsClient,
  AgentsListResult,
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
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify(result.agents, null, 2));
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
        console.error(`Agent "${name}" not found. Registered: ${names || "(none)"}`);
        process.exit(1);
      }
      if (opts.json) {
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify(result.agent, null, 2));
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
    { label: "Role", value: agent.role, role: "info" },
  ];
  if (agent.model) entries.push({ label: "Model", value: agent.model, role: "info" });
  entries.push({ label: "Prompt", value: agent.promptPath, role: "muted" });
  if (agent.skills) {
    const display = agent.skills === "all" ? "all" : agent.skills.join(", ");
    entries.push({ label: "Skills", value: display, role: "muted" });
  }
  entries.push({
    label: "WriteScope",
    value: agent.writeScope.length === 0 ? "<unrestricted>" : agent.writeScope.join(", "),
    role: "muted",
  });
  if (agent.tools) {
    if (agent.tools.allowed) {
      entries.push({ label: "Allowed", value: agent.tools.allowed.join(", "), role: "success" });
    }
    if (agent.tools.disallowed) {
      entries.push({ label: "Blocked", value: agent.tools.disallowed.join(", "), role: "error" });
    }
  }
  return entries;
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
