import type { WorkflowTriggerInput } from "#core/workflow/trigger-types.js";
import {
  scopeImprovementEvidenceReady,
  scopeImprovementRequested,
} from "./events.js";
import { SCOPE_IMPROVEMENT_SCHEDULE_EVENT } from "./scope-improvement-types.js";

export const scopeImproverTriggers: WorkflowTriggerInput[] = [
  { event: scopeImprovementRequested.name, cooldownMs: 60_000 },
  {
    event: SCOPE_IMPROVEMENT_SCHEDULE_EVENT,
    schedule: "30 */4 * * *",
    cooldownMs: 60 * 60 * 1000,
  },
  { event: scopeImprovementEvidenceReady.name },
  { event: "runtime.recovered" },
];
