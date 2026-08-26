import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { matchesFilter } from "./run-executor-utils.js";
import type { WorkflowStep } from "./step-types.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowPostReconcileInvariant,
} from "./types.js";
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
 * `matchesFilter`).
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
    defaultAutonomyMode,
    repository: (() => {
      const value: unknown = definition.repository;
      if (value === undefined) {
        throw new WorkflowDefinitionError(
          'repository is required and must explicitly declare "none", "read", or "write"',
          definitionPath,
        );
      }
      if (value !== "none" && value !== "read" && value !== "write") {
        throw new WorkflowDefinitionError(
          'repository must be one of "none", "read", or "write"',
          definitionPath,
        );
      }
      return value;
    })(),
    integration: (() => {
      if (definition.integration === undefined) return undefined;
      if (
        typeof definition.integration !== "object" ||
        definition.integration === null ||
        Array.isArray(definition.integration)
      ) {
        throw new WorkflowDefinitionError("integration must be an object", definitionPath);
      }
      const raw = definition.integration as Record<string, unknown>;
      rejectUnknownKeys(
        raw,
        ["validationCommand", "postReconcile"],
        "integration",
        definitionPath,
      );
      const command = raw.validationCommand;
      if (
        !Array.isArray(command) ||
        command.length === 0 ||
        command.some((part) => typeof part !== "string" || part.trim() === "")
      ) {
        throw new WorkflowDefinitionError(
          "integration.validationCommand must be a non-empty string array",
          definitionPath,
        );
      }
      const postReconcile = raw.postReconcile;
      if (postReconcile !== undefined && typeof postReconcile !== "function") {
        throw new WorkflowDefinitionError(
          "integration.postReconcile must be a function",
          definitionPath,
        );
      }
      return {
        validationCommand: command as [string, ...string[]],
        ...(postReconcile === undefined
          ? {}
          : { postReconcile: postReconcile as WorkflowPostReconcileInvariant }),
      };
    })(),
    resources: (() => {
      if (definition.resources === undefined) return undefined;
      if (typeof definition.resources !== "function") {
        throw new WorkflowDefinitionError("resources must be a function", definitionPath);
      }
      return definition.resources;
    })(),
    triggerAdmission: (() => {
      if (definition.triggerAdmission === undefined) return undefined;
      if (typeof definition.triggerAdmission !== "function") {
        throw new WorkflowDefinitionError(
          "triggerAdmission must be a function",
          definitionPath,
        );
      }
      return definition.triggerAdmission;
    })(),
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

  if (validated.repository === "write" && validated.integration === undefined) {
    throw new WorkflowDefinitionError(
      `workflow "${name}" requests write access but has no integration policy`,
      definitionPath,
    );
  }
  if (validated.repository !== "write" && validated.integration !== undefined) {
    throw new WorkflowDefinitionError(
      `workflow "${name}" declares integration but does not request write access`,
      definitionPath,
    );
  }

  return validated;
}
