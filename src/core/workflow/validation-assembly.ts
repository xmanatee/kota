import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { matchesFilter } from "./run-executor-utils.js";
import type { WorkflowStep } from "./step-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import {
  expectOptionalBoolean,
  expectOptionalInteger,
  expectOptionalString,
  rejectUnknownKeys,
  WorkflowDefinitionError,
} from "./validation-primitives.js";
import { validateTrigger } from "./validation-trigger.js";

/**
 * Assembles a validated `WorkflowDefinition` from the raw input plus the
 * already-validated shape and step list. Owns the per-definition assembly
 * IIFEs that build `webhookRateLimit`, `notify`, `tags`, and the validated
 * `triggers` array (including the `workflow.completed` self-loop check via
 * `matchesFilter`), and enforces the `runtime.recovered` ↔ `recoveryCapable`
 * consistency rule once those derived fields are known.
 */
export function assembleWorkflowDefinition(
  definition: RegisteredWorkflowDefinitionInput,
  definitionPath: string,
  name: string,
  moduleRoot: string,
  defaultAutonomyMode: AutonomyMode | undefined,
  steps: WorkflowStep[],
): WorkflowDefinition {
  const validated: WorkflowDefinition = {
    name,
    moduleRoot,
    description: expectOptionalString(
      definition.description,
      "description",
      definitionPath,
    ),
    enabled: expectOptionalBoolean(
      definition.enabled,
      "enabled",
      definitionPath,
    ) ?? true,
    runTimeoutMs: expectOptionalInteger(
      definition.runTimeoutMs,
      "runTimeoutMs",
      definitionPath,
      1,
    ),
    recoveryCapable: expectOptionalBoolean(
      definition.recoveryCapable,
      "recoveryCapable",
      definitionPath,
    ) ?? false,
    defaultAutonomyMode,
    concurrencyGroup: expectOptionalString(
      definition.concurrencyGroup,
      "concurrencyGroup",
      definitionPath,
    ),
    inputSchema:
      definition.inputSchema != null
        ? (definition.inputSchema as Record<string, unknown>)
        : undefined,
    outputSchema:
      definition.outputSchema != null
        ? (definition.outputSchema as Record<string, unknown>)
        : undefined,
    webhookRateLimit: (() => {
      if (definition.webhookRateLimit == null) return undefined;
      const rl = definition.webhookRateLimit;
      if (typeof rl !== "object" || rl === null) {
        throw new WorkflowDefinitionError(
          "webhookRateLimit must be an object",
          definitionPath,
        );
      }
      const maxPerMinute = expectOptionalInteger(
        (rl as { maxPerMinute?: unknown }).maxPerMinute,
        "webhookRateLimit.maxPerMinute",
        definitionPath,
        1,
      );
      if (!maxPerMinute || maxPerMinute < 1) {
        throw new WorkflowDefinitionError(
          "webhookRateLimit.maxPerMinute must be an integer >= 1",
          definitionPath,
        );
      }
      return { maxPerMinute };
    })(),
    notify: (() => {
      if (definition.notify == null) return undefined;
      const n = definition.notify;
      if (typeof n !== "object" || n === null || Array.isArray(n)) {
        throw new WorkflowDefinitionError("notify must be an object", definitionPath);
      }
      const raw = n as Record<string, unknown>;
      rejectUnknownKeys(raw, ["onFailure", "onSuccess"], "notify", definitionPath);
      const onFailure = expectOptionalBoolean(raw.onFailure, "notify.onFailure", definitionPath);
      const onSuccess = expectOptionalBoolean(raw.onSuccess, "notify.onSuccess", definitionPath);
      return {
        ...(onFailure !== undefined ? { onFailure } : {}),
        ...(onSuccess !== undefined ? { onSuccess } : {}),
      };
    })(),
    tags: (() => {
      const raw = definition.tags;
      if (raw === undefined) return [];
      if (!Array.isArray(raw) || raw.some((t: unknown) => typeof t !== "string")) {
        throw new WorkflowDefinitionError("tags must be an array of strings", definitionPath);
      }
      return raw as readonly string[];
    })(),
    definitionPath,
    triggers: (() => {
      const triggers = definition.triggers.map((trigger, triggerIndex) =>
        validateTrigger(trigger, definitionPath, triggerIndex),
      );
      for (const trigger of triggers) {
        if (trigger.event === "workflow.completed") {
          const ownTags = definition.tags ?? [];
          const selfMatches = [
            "success",
            "failed",
            "interrupted",
            "completed-with-warnings",
          ].some((status) =>
            matchesFilter(trigger.filter, {
              workflow: name,
              status,
              triggerEvent: "manual",
              durationMs: 0,
              definitionPath,
              runDir: ".kota/runs/self",
              runId: "self",
              tags: ownTags,
            }),
          );
          if (selfMatches) {
            throw new WorkflowDefinitionError(
              `workflow "${name}" has a "workflow.completed" trigger that can match its own completion payload — ` +
                `this would trigger after the workflow's own completion and create an infinite loop.`,
              definitionPath,
            );
          }
        }
      }
      return triggers;
    })(),
    steps,
  };

  const hasRecoveredTrigger = definition.triggers.some(
    (t) => t.event === "runtime.recovered",
  );
  if (hasRecoveredTrigger && !validated.recoveryCapable) {
    throw new WorkflowDefinitionError(
      `workflow "${name}" listens to "runtime.recovered" but does not set recoveryCapable: true — ` +
        `the runtime filters recovery dispatch to recovery-capable workflows, so this trigger would never fire`,
      definitionPath,
    );
  }

  return validated;
}
