/**
 * Agent ops module — owns the `kota agent` inspection surface.
 *
 * Agent definitions are contributed by loaded modules. This module does not
 * maintain a separate registry; it reflects whatever the current module set
 * provides.
 */

import { Command } from "commander";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";

function buildAgentEntries(ctx: ModuleContext): Array<AgentDef & { source: string }> {
  const agentModels = ctx.config.agentModels ?? {};
  const entries: Array<AgentDef & { source: string }> = [];

  for (const summary of ctx.getModuleSummaries()) {
    for (const agent of summary.agents) {
      if (entries.some((entry) => entry.name === agent.name)) continue;
      entries.push({
        ...agent,
        model: agentModels[agent.name] ?? agent.model,
        source: summary.name,
      });
    }
  }

  return entries;
}

function buildAgentCommand(ctx: ModuleContext): Command {
  const agentCmd = new Command("agent").description("Inspect available agents");

  agentCmd
    .command("list")
    .description("List all contributed agents")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const agents = buildAgentEntries(ctx);
      if (opts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      if (agents.length === 0) {
        console.log("No agents available.");
        return;
      }
      const nameWidth = Math.max(...agents.map((agent) => agent.name.length), 4);
      const modelWidth = Math.max(...agents.map((agent) => (agent.model ?? "").length), 5);
      const sourceWidth = Math.max(...agents.map((agent) => agent.source.length), 6);
      console.log(
        `${"Name".padEnd(nameWidth)}  ${"Model".padEnd(modelWidth)}  ${"Source".padEnd(sourceWidth)}  Role`,
      );
      console.log("-".repeat(nameWidth + modelWidth + sourceWidth + 10));
      for (const agent of agents) {
        console.log(
          `${agent.name.padEnd(nameWidth)}  ${(agent.model ?? "").padEnd(modelWidth)}  ${agent.source.padEnd(sourceWidth)}  ${agent.role}`,
        );
      }
    });

  agentCmd
    .command("inspect <name>")
    .description("Show full detail for one agent")
    .option("--json", "Output as JSON")
    .action((name: string, opts: { json?: boolean }) => {
      const agents = buildAgentEntries(ctx);
      const agent = agents.find((entry) => entry.name === name);
      if (!agent) {
        const names = agents.map((entry) => entry.name).join(", ");
        console.error(`Agent "${name}" not found. Registered: ${names || "(none)"}`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(agent, null, 2));
        return;
      }
      console.log(`Name:       ${agent.name}`);
      console.log(`Source:     ${agent.source}`);
      console.log(`Role:       ${agent.role}`);
      if (agent.model) console.log(`Model:      ${agent.model}`);
      console.log(`Prompt:     ${agent.promptPath}`);
      if (agent.skills) {
        const display = agent.skills === "all" ? "all" : agent.skills.join(", ");
        console.log(`Skills:     ${display}`);
      }
      if (agent.writeScope && agent.writeScope.length > 0) {
        console.log(`WriteScope: ${agent.writeScope.join(", ")}`);
      }
      if (agent.tools) {
        if (agent.tools.permissionMode) console.log(`Permission: ${agent.tools.permissionMode}`);
        if (agent.tools.allowed) console.log(`Allowed:    ${agent.tools.allowed.join(", ")}`);
        if (agent.tools.disallowed) console.log(`Blocked:    ${agent.tools.disallowed.join(", ")}`);
      }
    });

  return agentCmd;
}

const agentsModule: KotaModule = {
  name: "agent-ops",
  version: "1.0.0",
  description: "Operator CLI for inspecting contributed agents",
  commands: (ctx: ModuleContext) => [buildAgentCommand(ctx)],
};

export default agentsModule;
