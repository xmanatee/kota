/**
 * Agent ops module — owns the `kota agent` inspection surface.
 *
 * Agent definitions are contributed by loaded modules. This module does not
 * maintain a separate registry; it reflects whatever the current module set
 * provides.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { AgentSummary, AgentsClient } from "#core/server/kota-client.js";
import {
  type KVEntry,
  kvBlock,
  type LineNode,
  line,
  plain,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { inspectAgent, listAgents } from "./agent-ops-operations.js";
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
      print(stack(...buildAgentListLines(result.agents)));
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

export function buildAgentListLines(agents: AgentSummary[]): LineNode[] {
  const nameWidth = Math.max(...agents.map((agent) => agent.name.length), 4);
  const modelWidth = Math.max(...agents.map((agent) => agent.model.length), 5);
  const sourceWidth = Math.max(...agents.map((agent) => agent.source.length), 6);
  const header = line(span(
    `${"Name".padEnd(nameWidth)}  ${"Model".padEnd(modelWidth)}  ${"Source".padEnd(sourceWidth)}  Role`,
    "muted",
    true,
  ));
  const rule = line(span("-".repeat(nameWidth + modelWidth + sourceWidth + 10), "muted"));
  const rows: LineNode[] = agents.map((agent) => line(
    span(agent.name.padEnd(nameWidth), "accent"),
    plain("  "),
    span(agent.model.padEnd(modelWidth), "info"),
    plain("  "),
    span(agent.source.padEnd(sourceWidth), "muted"),
    plain(`  ${agent.role}`),
  ));
  return [header, rule, ...rows];
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
};

export default agentsModule;
