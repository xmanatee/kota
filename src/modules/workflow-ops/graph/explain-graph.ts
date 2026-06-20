import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { assembleWorkflowGraph } from "./assemble.js";
import { buildLookups } from "./explain-effects.js";
import { buildAutomationEvents } from "./explain-events.js";
import {
  buildAutomationWorkflow,
  buildConsumersByEvent,
} from "./explain-workflow.js";
import type { CompiledAutomationGraph } from "./types.js";

export type AssembleCompiledAutomationGraphOptions = {
  moduleManifests?: readonly ModuleCapabilityManifestProjection[];
};

export function assembleCompiledAutomationGraph(
  definitions: readonly WorkflowDefinition[],
  options: AssembleCompiledAutomationGraphOptions = {},
): CompiledAutomationGraph {
  const base = assembleWorkflowGraph(definitions, {
    moduleManifests: options.moduleManifests,
  });
  const graph: CompiledAutomationGraph = {
    ...base,
    automation: {
      workflows: [],
      events: [],
      blockers: [],
      downstream: [],
    },
  };
  const lookups = buildLookups(options.moduleManifests ?? []);
  const consumersByEvent = buildConsumersByEvent(definitions);
  const workflows = definitions.map((definition) =>
    buildAutomationWorkflow(definition, graph, lookups, consumersByEvent)
  );
  const downstream = workflows.flatMap((workflow) => workflow.downstream);
  const blockers = workflows.flatMap((workflow) => workflow.blockers);
  return {
    ...graph,
    automation: {
      workflows,
      events: buildAutomationEvents(graph),
      blockers,
      downstream,
    },
  };
}
