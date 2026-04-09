import type { AgentDef } from "../agent-types.js";

export const BUILTIN_AUTONOMY_AGENTS: readonly AgentDef[] = [
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
