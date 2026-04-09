/**
 * Agents extension — owns built-in agent definitions, the agent registry,
 * and the `kota agent` CLI surface.
 */

import { Command } from "commander";
import type { AgentDef } from "../../agent-types.js";
import type { ExtensionContext, KotaExtension } from "../../extension-types.js";

export const BUILTIN_AGENTS: readonly AgentDef[] = [
  {
    name: "inbox-sorter",
    role: "Sort rough inbox captures into normalized tasks, docs, or other durable project artifacts.",
    promptPath: "src/workflows/inbox-sorter/prompt.md",
    model: "claude-sonnet-4-6",
    tools: { permissionMode: "bypassPermissions" },
    writeScope: ["data/", "docs/"],
    settingSources: ["project"],
  },
  {
    name: "explorer",
    role: "Maintain a strong task portfolio by studying the codebase, recent work, and external ideas.",
    promptPath: "src/workflows/explorer/prompt.md",
    model: "claude-sonnet-4-6",
    tools: { permissionMode: "bypassPermissions" },
    writeScope: ["data/"],
    settingSources: ["project"],
  },
  {
    name: "builder",
    role: "Ship one cohesive improvement per run by implementing tasks from the ready queue.",
    promptPath: "src/workflows/builder/prompt.md",
    model: "claude-sonnet-4-6",
    tools: { permissionMode: "bypassPermissions" },
    settingSources: ["project"],
  },
  {
    name: "improver",
    role: "Steer the autonomous development system toward higher-quality, more ambitious work by improving prompts, workflows, and protocols.",
    promptPath: "src/workflows/improver/prompt.md",
    model: "claude-sonnet-4-6",
    tools: { permissionMode: "bypassPermissions" },
    settingSources: ["project"],
  },
];

const registry = new Map<string, AgentDef>(BUILTIN_AGENTS.map((a) => [a.name, a]));

/** Register an agent definition. Overwrites any existing definition with the same name. */
export function registerAgent(def: AgentDef): void {
  registry.set(def.name, def);
}

/** Look up a registered agent by name. Returns undefined if not found. */
export function getAgent(name: string): AgentDef | undefined {
  return registry.get(name);
}

/** List all registered agents (built-in and extension-contributed). */
export function listAgents(): readonly AgentDef[] {
  return Array.from(registry.values());
}

function buildAgentCommand(ctx: ExtensionContext): Command {
  const agentCmd = new Command("agent").description("Inspect registered agents");

  agentCmd
    .command("list")
    .description("List all registered agents (built-in and contributed)")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const agentModels = ctx.config.agentModels ?? {};
      const summaries = ctx.getExtensionSummaries();
      type AgentEntry = AgentDef & { source: string };
      const agents: AgentEntry[] = [];
      for (const summary of summaries) {
        for (const agent of summary.agents) {
          if (!agents.find((a) => a.name === agent.name)) {
            agents.push({
              ...agent,
              model: agentModels[agent.name] ?? agent.model,
              source: summary.name,
            });
          }
        }
      }
      if (opts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      if (agents.length === 0) {
        console.log("No agents registered.");
        return;
      }
      const nameWidth = Math.max(...agents.map((a) => a.name.length), 4);
      const modelWidth = Math.max(...agents.map((a) => (a.model ?? "").length), 5);
      const srcWidth = Math.max(...agents.map((a) => a.source.length), 6);
      console.log(
        `${"Name".padEnd(nameWidth)}  ${"Model".padEnd(modelWidth)}  ${"Source".padEnd(srcWidth)}  Role`,
      );
      console.log("-".repeat(nameWidth + modelWidth + srcWidth + 10));
      for (const a of agents) {
        const model = (a.model ?? "").padEnd(modelWidth);
        console.log(`${a.name.padEnd(nameWidth)}  ${model}  ${a.source.padEnd(srcWidth)}  ${a.role}`);
      }
    });

  agentCmd
    .command("inspect <name>")
    .description("Show full detail for one agent")
    .option("--json", "Output as JSON")
    .action((name: string, opts: { json?: boolean }) => {
      const agentModels = ctx.config.agentModels ?? {};
      const summaries = ctx.getExtensionSummaries();
      const agents = summaries.flatMap((s) =>
        s.agents.map((a) => ({
          ...a,
          model: agentModels[a.name] ?? a.model,
          source: s.name,
        })),
      );
      const agent = agents.find((a) => a.name === name);
      if (!agent) {
        const names = agents.map((a) => a.name).join(", ");
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
      if (agent.skills && agent.skills.length > 0) {
        console.log(`Skills:     ${agent.skills.join(", ")}`);
      }
      if (agent.writeScope && agent.writeScope.length > 0) {
        console.log(`WriteScope: ${agent.writeScope.join(", ")}`);
      }
      if (agent.tools) {
        const policy = agent.tools;
        if (policy.permissionMode) console.log(`Permission: ${policy.permissionMode}`);
        if (policy.allowed) console.log(`Allowed:    ${policy.allowed.join(", ")}`);
        if (policy.disallowed) console.log(`Blocked:    ${policy.disallowed.join(", ")}`);
      }
    });

  return agentCmd;
}

const agentsModule: KotaExtension = {
  name: "agents",
  version: "1.0.0",
  description: "Built-in agent definitions and kota agent CLI",
  agents: [...BUILTIN_AGENTS],
  commands: (ctx: ExtensionContext) => [buildAgentCommand(ctx)],
};

export default agentsModule;
