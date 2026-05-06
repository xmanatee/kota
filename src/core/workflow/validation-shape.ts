import { isAbsolute } from "node:path";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";
import {
  expectName,
  expectRelativePath,
  WorkflowDefinitionError,
} from "./validation-primitives.js";

export type ValidatedWorkflowShape = {
  definitionPath: string;
  name: string;
  moduleRoot: string;
  defaultAutonomyMode: AutonomyMode | undefined;
};

/**
 * Human-readable identity for a contributing workflow definition. Used in
 * duplicate-name diagnostics so the operator can tell which module shipped
 * each colliding definition.
 */
export function describeContribution(
  def: Pick<
    RegisteredWorkflowDefinitionInput,
    "contributingModule" | "moduleSource" | "definitionPath"
  >,
): string {
  if (def.contributingModule && def.moduleSource) {
    return `module "${def.contributingModule}" (${def.moduleSource}) — ${def.definitionPath}`;
  }
  if (def.contributingModule) {
    return `module "${def.contributingModule}" — ${def.definitionPath}`;
  }
  return def.definitionPath;
}

/**
 * Top-level workflow-shape checks: definition path, name, name uniqueness
 * across contributing modules, moduleRoot absolute-path requirement,
 * non-empty triggers/steps, and `defaultAutonomyMode` validation. Mutates
 * the shared `seenWorkflowNames` map so callers can detect duplicates across
 * the whole contribution set in a single pass.
 */
export function validateWorkflowShape(
  definition: RegisteredWorkflowDefinitionInput,
  definitionIndex: number,
  projectDir: string,
  seenWorkflowNames: Map<string, RegisteredWorkflowDefinitionInput>,
): ValidatedWorkflowShape {
  const definitionPath = expectRelativePath(
    definition.definitionPath,
    `definitions[${definitionIndex}].definitionPath`,
    `<workflow-${definitionIndex}>`,
  );
  const name = expectName(definition.name, "name", definitionPath);
  const moduleRoot = definition.moduleRoot ?? projectDir;
  if (typeof moduleRoot !== "string" || !isAbsolute(moduleRoot)) {
    throw new WorkflowDefinitionError(
      `moduleRoot must be an absolute path, got "${String(moduleRoot)}"`,
      definitionPath,
    );
  }
  const prior = seenWorkflowNames.get(name);
  if (prior) {
    throw new WorkflowDefinitionError(
      `duplicate workflow name "${name}" contributed by ` +
        `${describeContribution(prior)} and ${describeContribution(definition)} — ` +
        "workflow names must be globally unique across every contributing module, " +
        "regardless of whether they are shipped by a KOTA module or by the target project's .kota/modules tree",
      definitionPath,
    );
  }
  seenWorkflowNames.set(name, definition);

  if (!Array.isArray(definition.triggers) || definition.triggers.length === 0) {
    throw new WorkflowDefinitionError(
      "triggers must be a non-empty array",
      definitionPath,
    );
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new WorkflowDefinitionError(
      "steps must be a non-empty array",
      definitionPath,
    );
  }

  const defaultAutonomyMode = definition.defaultAutonomyMode;
  if (
    defaultAutonomyMode !== undefined &&
    !isAutonomyMode(defaultAutonomyMode)
  ) {
    throw new WorkflowDefinitionError(
      `defaultAutonomyMode must be one of passive, supervised, autonomous`,
      definitionPath,
    );
  }

  return { definitionPath, name, moduleRoot, defaultAutonomyMode };
}
