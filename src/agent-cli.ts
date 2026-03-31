import type { Command } from "commander";
import type { AgentDef, SkillDef } from "./agent-types.js";
import { BUILTIN_AGENTS } from "./agents/index.js";
import { loadConfig } from "./config.js";
import { discoverExtensions } from "./extension-discovery.js";
import { ExtensionLoader } from "./extension-loader.js";
import { builtinExtensions } from "./extensions/index.js";

type AgentEntry = AgentDef & { source: string };
type SkillEntry = SkillDef & { source: string };

async function loadAgentsAndSkills(): Promise<{ agents: AgentEntry[]; skills: SkillEntry[] }> {
  const config = loadConfig();
  const loader = new ExtensionLoader(config);
  const discovered = await discoverExtensions(undefined, false);
  await loader.loadAll([...builtinExtensions, ...discovered]);
  const summaries = loader.getExtensionSummaries();

  const agentModels = config.agentModels ?? {};
  const agents: AgentEntry[] = BUILTIN_AGENTS.map((a) => ({
    ...a,
    model: agentModels[a.name] ?? a.model,
    source: "built-in",
  }));
  const skills: SkillEntry[] = [];

  for (const summary of summaries) {
    for (const agent of summary.agents) {
      if (!agents.find((a) => a.name === agent.name)) {
        agents.push({ ...agent, model: agentModels[agent.name] ?? agent.model, source: summary.name });
      }
    }
    for (const skill of summary.skills) {
      skills.push({ ...skill, source: summary.name });
    }
  }

  return { agents, skills };
}

export function registerAgentCommands(program: Command): void {
  const agentCmd = program
    .command("agent")
    .description("Inspect registered agents");

  agentCmd
    .command("list")
    .description("List all registered agents (built-in and contributed)")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const { agents } = await loadAgentsAndSkills();
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
    .action(async (name: string, opts: { json?: boolean }) => {
      const { agents } = await loadAgentsAndSkills();
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
}

export function registerSkillCommands(program: Command): void {
  const skillCmd = program
    .command("skill")
    .description("Inspect registered skills");

  skillCmd
    .command("list")
    .description("List all registered skills with source extension")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const { skills } = await loadAgentsAndSkills();
      if (opts.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (skills.length === 0) {
        console.log("No skills registered.");
        return;
      }
      const nameWidth = Math.max(...skills.map((s) => s.name.length), 4);
      const srcWidth = Math.max(...skills.map((s) => s.source.length), 6);
      console.log(`${"Name".padEnd(nameWidth)}  ${"Source".padEnd(srcWidth)}  Description`);
      console.log("-".repeat(nameWidth + srcWidth + 16));
      for (const s of skills) {
        const desc = s.description ?? "";
        console.log(`${s.name.padEnd(nameWidth)}  ${s.source.padEnd(srcWidth)}  ${desc}`);
      }
    });
}
