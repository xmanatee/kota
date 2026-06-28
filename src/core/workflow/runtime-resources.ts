import type {
  WorkflowRuntimeResources,
  WorkflowStepResult,
} from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";

type WorkflowOutputValue = WorkflowStepResult["output"];
type StringRecord = { [key: string]: string };
type ResourceOutput = {
  profileId?: WorkflowOutputValue;
  env?: WorkflowOutputValue;
  tempRoot?: WorkflowOutputValue;
  artifactRoot?: WorkflowOutputValue;
  ports?: WorkflowOutputValue;
};
type ResourceStepOutput = {
  runtimeResources?: WorkflowOutputValue;
};

function isStringRecord(value: WorkflowOutputValue): value is StringRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function optionalString(
  value: WorkflowOutputValue,
  stepId: string,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output.runtimeResources.${field} must be a non-empty string`,
    );
  }
  return value;
}

function optionalPortRange(
  value: WorkflowOutputValue,
  stepId: string,
): WorkflowRuntimeResources["ports"] {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output.runtimeResources.ports must be an object`,
    );
  }
  const range = value as {
    start?: WorkflowOutputValue;
    end?: WorkflowOutputValue;
  };
  const start = range.start;
  const end = range.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > 65_535
  ) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output.runtimeResources.ports must contain a valid start/end range`,
    );
  }
  return { start, end };
}

export function runtimeResourcesFromStepOutput(
  stepId: string,
  output: WorkflowStepResult["output"],
): WorkflowRuntimeResources {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output must be an object with runtimeResources`,
    );
  }
  const rawResources = (output as ResourceStepOutput).runtimeResources;
  if (
    rawResources === null ||
    typeof rawResources !== "object" ||
    Array.isArray(rawResources)
  ) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output.runtimeResources must be an object`,
    );
  }
  const resources = rawResources as ResourceOutput;
  if (typeof resources.profileId !== "string" || !resources.profileId.trim()) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output.runtimeResources.profileId must be a non-empty string`,
    );
  }
  if (!isStringRecord(resources.env)) {
    throw new Error(
      `Step "${stepId}" updatesRuntimeResources output.runtimeResources.env must be a string record`,
    );
  }
  const tempRoot = optionalString(resources.tempRoot, stepId, "tempRoot");
  const artifactRoot = optionalString(
    resources.artifactRoot,
    stepId,
    "artifactRoot",
  );
  const ports = optionalPortRange(resources.ports, stepId);
  return {
    profileId: resources.profileId,
    env: resources.env,
    ...(tempRoot !== undefined ? { tempRoot } : {}),
    ...(artifactRoot !== undefined ? { artifactRoot } : {}),
    ...(ports !== undefined ? { ports } : {}),
  };
}

export function replayRuntimeResourceUpdates(
  definition: WorkflowDefinition,
  retryFromIndex: number,
  stepResultsById: Record<string, WorkflowStepResult>,
  fallbackResources: WorkflowRuntimeResources | undefined,
): WorkflowRuntimeResources | undefined {
  let runtimeResources = fallbackResources;
  for (let i = 0; i < retryFromIndex; i++) {
    const step = definition.steps[i];
    if (step?.type !== "code" || step.updatesRuntimeResources !== true) {
      continue;
    }
    const result = stepResultsById[step.id];
    if (result?.status !== "success") continue;
    runtimeResources = runtimeResourcesFromStepOutput(step.id, result.output);
  }
  return runtimeResources;
}
