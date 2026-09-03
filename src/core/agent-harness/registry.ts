import type { AgentHarness } from "./types.js";

type HarnessRegistration = {
  token: symbol;
  harness: AgentHarness;
};

const harnesses = new Map<string, HarnessRegistration[]>();

/** Register an adapter and return a disposer for this exact registration. */
export function registerAgentHarness(harness: AgentHarness): () => void {
  if (!harness.name || typeof harness.name !== "string") {
    throw new Error("Agent harness must declare a non-empty string name");
  }
  const registration = { token: Symbol(harness.name), harness };
  const registrations = harnesses.get(harness.name) ?? [];
  registrations.push(registration);
  harnesses.set(harness.name, registrations);
  return () => {
    const current = harnesses.get(harness.name);
    if (!current) return;
    const index = current.findIndex((entry) => entry.token === registration.token);
    if (index < 0) return;
    current.splice(index, 1);
    if (current.length === 0) harnesses.delete(harness.name);
  };
}

export function resolveAgentHarness(name: string): AgentHarness {
  const registrations = harnesses.get(name);
  const harness = registrations?.at(-1)?.harness;
  if (harness === undefined) {
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
  return (harnesses.get(name)?.length ?? 0) > 0;
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
