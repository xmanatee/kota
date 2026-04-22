import type { AgentHarness } from "./types.js";

const harnesses = new Map<string, AgentHarness>();

export function registerAgentHarness(harness: AgentHarness): void {
  if (!harness.name || typeof harness.name !== "string") {
    throw new Error("Agent harness must declare a non-empty string name");
  }
  harnesses.set(harness.name, harness);
}

export function resolveAgentHarness(name: string): AgentHarness {
  const harness = harnesses.get(name);
  if (!harness) {
    const available = listAgentHarnessNames();
    const suffix =
      available.length > 0
        ? ` (registered: ${available.join(", ")})`
        : " (no harnesses are registered — load a harness module such as claude-agent-harness)";
    throw new Error(`Unknown agent harness "${name}"${suffix}`);
  }
  return harness;
}

export function hasAgentHarness(name: string): boolean {
  return harnesses.has(name);
}

export function listAgentHarnessNames(): string[] {
  return [...harnesses.keys()].sort();
}

/**
 * Test-only helper — drops every registered harness. Never call from
 * production code: the registry is process-global and a runtime clear would
 * leave core call sites unable to resolve adapters mid-run.
 */
export function clearAgentHarnessRegistryForTest(): void {
  harnesses.clear();
}
