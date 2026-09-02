import { join } from "node:path";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import type { ScopeOnboardingOperation } from "./scope-onboarding-types.js";

const OPERATION_ID = /^onboard_[a-f0-9]{24}$/;

export class ScopeOnboardingOperationStore {
  readonly #directory: string;

  constructor(stateDir: string) {
    this.#directory = join(stateDir, "scope-onboarding");
  }

  read(operationId: string): ScopeOnboardingOperation | null {
    const value = readOptionalJsonFile<unknown>(this.#path(operationId));
    if (value === null) return null;
    if (!isOperation(value) || value.operationId !== operationId) {
      throw new Error(`Invalid scope onboarding operation ${operationId}`);
    }
    return value;
  }

  write(operation: ScopeOnboardingOperation): void {
    writeJsonFileAtomic(this.#path(operation.operationId), operation, undefined, {
      mode: 0o600,
    });
  }

  #path(operationId: string): string {
    if (!OPERATION_ID.test(operationId)) {
      throw new Error("Invalid scope onboarding operation id");
    }
    return join(this.#directory, `${operationId}.json`);
  }
}

function isOperation(value: unknown): value is ScopeOnboardingOperation {
  if (!isRecord(value)) return false;
  if (
    value.schema !== 1 ||
    typeof value.operationId !== "string" ||
    !OPERATION_ID.test(value.operationId) ||
    !["planned", "applying", "succeeded", "incomplete", "cancelled"].includes(
      String(value.state),
    ) ||
    typeof value.attempts !== "number" ||
    typeof value.registeredByOperation !== "boolean" ||
    typeof value.authorityRevision !== "number" ||
    !(value.authorityApplied === null || isRecord(value.authorityApplied)) ||
    !(value.displayNameBefore === null || typeof value.displayNameBefore === "string") ||
    !Array.isArray(value.mutations) ||
    !isRecord(value.acceptedPlan) ||
    !isRecord(value.readiness) ||
    !isRecord(value.provenance)
  ) return false;
  return value.error === null || isRecord(value.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
