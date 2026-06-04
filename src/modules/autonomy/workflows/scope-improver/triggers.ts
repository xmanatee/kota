import type { WorkflowTriggerInput } from "#core/workflow/trigger-types.js";
import { scopeImprovementRequested } from "./events.js";
import { SCOPE_IMPROVEMENT_SCHEDULE_EVENT } from "./scope-improvement-types.js";

export const scopeImproverTriggers: WorkflowTriggerInput[] = [
  { event: scopeImprovementRequested.name, cooldownMs: 60_000 },
  {
    event: SCOPE_IMPROVEMENT_SCHEDULE_EVENT,
    schedule: "30 */4 * * *",
    cooldownMs: 60 * 60 * 1000,
  },
  {
    watch: [
      "**/*.md",
      "**/*.txt",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
      "**/*.ts",
      "**/*.tsx",
    ],
    debounceMs: 5_000,
  },
  {
    event: "task.changed",
    batch: {
      maxCount: 5,
      maxAgeMs: 10 * 60 * 1000,
      groupBy: "projectId",
      maxBufferSize: 20,
      overflow: "flush-oldest",
    },
  },
  {
    event: "workflow.build.committed",
    cooldownMs: 5 * 60 * 1000,
  },
  { event: "runtime.recovered" },
];
