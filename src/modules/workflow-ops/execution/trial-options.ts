import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowTrialOptions, WorkflowTrialPayload } from "../client.js";
import type { TrialVariant } from "./trial-internal-types.js";
import { WorkflowTrialRequestError } from "./trial-internal-types.js";

type WorkflowRuntimePayload = WorkflowRunTrigger["payload"];

export function cloneTrialPayload(
  payload: WorkflowTrialPayload | WorkflowRuntimePayload,
): WorkflowTrialPayload {
  return decodeTrialPayload(JSON.parse(JSON.stringify(payload)) as unknown);
}

export function projectTrialPayload(
  payload: WorkflowTrialPayload | WorkflowRuntimePayload,
): WorkflowTrialPayload {
  return decodeTrialPayload(projectEvidenceObject(payload, "internal-storage"));
}

function isJsonValue(value: unknown): value is KotaJsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

export function isJsonObject(value: unknown): value is WorkflowTrialPayload {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(isJsonValue)
  );
}

export function parseJsonObject(value: string, label: string): WorkflowTrialPayload {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function decodeTrialPayload(value: unknown): WorkflowTrialPayload {
  if (!isJsonObject(value)) {
    throw new Error("Workflow trial payload projection must remain a JSON object");
  }
  return value;
}

export function normalizeTrialRepeat(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new WorkflowTrialRequestError(
      "--repeat must be an integer from 1 to 20",
      "invalid_request",
    );
  }
  return value;
}

export function buildTrialVariants(
  workflowName: string,
  options: WorkflowTrialOptions | undefined,
): TrialVariant[] {
  const payload = cloneTrialPayload(options?.payload ?? {});
  const variants: TrialVariant[] = [
    { label: "primary", workflow: workflowName, payload },
  ];
  for (const workflow of options?.compareWorkflows ?? []) {
    if (workflow !== workflowName) {
      variants.push({
        label: `workflow-${workflow}`,
        workflow,
        payload: cloneTrialPayload(payload),
      });
    }
  }
  for (let index = 0; index < (options?.comparePayloads ?? []).length; index++) {
    const comparePayload = options!.comparePayloads![index]!;
    variants.push({
      label: `payload-${index + 1}`,
      workflow: workflowName,
      payload: cloneTrialPayload(comparePayload),
    });
  }
  return variants;
}
