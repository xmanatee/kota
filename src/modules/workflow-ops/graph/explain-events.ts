import { getModuleEventRegistry } from "#core/events/module-event.js";
import { schemaSummaryFromRegistration } from "./explain-triggers.js";
import type { AutomationEventNode, CompiledAutomationGraph } from "./types.js";

export function buildAutomationEvents(
  graph: CompiledAutomationGraph,
): AutomationEventNode[] {
  const registry = getModuleEventRegistry();
  const eventNames = new Set<string>(graph.events.map((event) => event.name));
  for (const registration of registry?.all().values() ?? []) {
    eventNames.add(registration.name);
  }
  return [...eventNames]
    .sort()
    .map((name) => {
      const event = graph.events.find((candidate) => candidate.name === name);
      const registered = registry?.get(name);
      return {
        name,
        producers: event?.producers ?? [],
        consumers: event?.consumers ?? [],
        ...(registered ? { schema: schemaSummaryFromRegistration(registered) } : {}),
      };
    });
}
