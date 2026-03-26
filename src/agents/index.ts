/**
 * Built-in agent definitions and registry.
 *
 * This is the canonical list of KOTA's built-in autonomous workers.
 * Extensions can contribute additional agents via KotaExtension.agents.
 */

import type { AgentDef } from "../agent-types.js";

export const BUILTIN_AGENTS: readonly AgentDef[] = [
  {
    name: "explorer",
    role: "Maintain a strong task portfolio by studying the codebase, recent work, and external ideas.",
    promptPath: "src/workflows/explorer/prompt.md",
    model: "claude-sonnet-4-6",
    tools: { permissionMode: "bypassPermissions" },
    writeScope: ["tasks/"],
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
    role: "Improve the autonomous development system itself using evidence from recent runs.",
    promptPath: "src/workflows/improver/prompt.md",
    model: "claude-sonnet-4-6",
    tools: { permissionMode: "bypassPermissions" },
    settingSources: ["project"],
  },
];

const registry = new Map<string, AgentDef>(
  BUILTIN_AGENTS.map((a) => [a.name, a]),
);

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
