import type { WorkflowTriggerInput } from "#core/workflow/trigger-types.js";
import {
  scopeImprovementChanged,
  scopeImprovementRequested,
} from "./events.js";

export const scopeImproverTriggers: WorkflowTriggerInput[] = [
  {
    event: scopeImprovementRequested.name,
    cooldownMs: 0,
    queueMode: "all",
  },
  {
    event: scopeImprovementChanged.name,
    cooldownMs: 0,
    queueMode: "latest",
  },
];
