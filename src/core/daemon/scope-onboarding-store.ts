import { join } from "node:path";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import type {
  ScopeImprovementPosture,
  ScopeOnboardingOperation,
} from "./scope-onboarding-types.js";
import type { ScopeWriteBoundary } from "./scope-policy.js";

const OPERATION_ID = /^onboard_[a-f0-9]{24}$/;

export class ScopeOnboardingOperationStore {
  readonly #directory: string;

  constructor(stateDir: string) {
    this.#directory = join(stateDir, "scope-onboarding");
  }

  read(operationId: string): ScopeOnboardingOperation | null {
    const value = readOptionalJsonFile<unknown>(this.#path(operationId));
    if (value === null) return null;
    if (isOperation(value) && value.operationId === operationId) return value;
    const migrated = migrateSchemaOneOperation(value);
    if (migrated === null || migrated.operationId !== operationId) {
      throw new Error(`Invalid scope onboarding operation ${operationId}`);
    }
    // Migration is part of the durable read boundary: recovery must never
    // observe the removed choice field or depend on an implicit fallback.
    this.write(migrated);
    return migrated;
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
  if (!hasOperationEnvelope(value, 2)) return false;
  const plan = value.acceptedPlan;
  const choices = plan.choices;
  const permissions = plan.permissions;
  if (
    plan.schema !== 2 ||
    !isRecord(choices) ||
    !isImprovementPosture(choices.improvementPosture) ||
    !isWriteBoundary(choices.writes) ||
    !isRecord(permissions)
  ) return false;
  const posture = choices.improvementPosture;
  const writes = choices.writes;
  const readinessImprovement = value.readiness.improvement;
  const permissionImprovement = permissions.improvement;
  return permissions.autonomy === postureAutonomyMode(posture) &&
    sameWriteBoundary(permissions.writes, writes) &&
    isRecord(readinessImprovement) &&
    isImprovementProjection(readinessImprovement) &&
    isLegacyAutonomyMode(readinessImprovement.autonomyMode) &&
    isWriteBoundary(readinessImprovement.writes) &&
    isRecord(permissionImprovement) &&
    isImprovementProjection(permissionImprovement, posture);
}

function hasOperationEnvelope(
  value: unknown,
  schema: 1 | 2,
): value is Record<string, unknown> & {
  acceptedPlan: Record<string, unknown>;
  readiness: Record<string, unknown>;
} {
  if (!isRecord(value)) return false;
  if (
    value.schema !== schema ||
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

function migrateSchemaOneOperation(value: unknown): ScopeOnboardingOperation | null {
  if (!hasOperationEnvelope(value, 1)) return null;
  const plan = value.acceptedPlan;
  const choices = plan.choices;
  const permissions = plan.permissions;
  if (
    plan.schema !== 1 ||
    !isRecord(choices) ||
    typeof choices.displayName !== "string" ||
    typeof choices.trust !== "boolean" ||
    !isLegacyAutonomyMode(choices.initialAutomationMode) ||
    !isWriteBoundary(choices.writes) ||
    !Array.isArray(plan.changes) ||
    !isRecord(permissions)
  ) return null;

  const autonomyMode = choices.initialAutomationMode;
  const posture = legacyPosture(autonomyMode);
  const writes = choices.writes;
  const { initialAutomationMode: _legacyMode, ...remainingChoices } = choices;
  const migratedPlan = {
    ...plan,
    schema: 2,
    choices: {
      ...remainingChoices,
      improvementPosture: posture,
    },
    changes: plan.changes.map((change) => {
      if (!isRecord(change) || change.kind !== "set-authority") return change;
      const { initialAutomationMode: _changeLegacyMode, ...remainingChange } = change;
      return { ...remainingChange, improvementPosture: posture };
    }),
    permissions: {
      ...permissions,
      autonomy: autonomyMode,
      writes,
      improvement: improvementProjection(posture),
    },
  };
  const migrated = {
    ...value,
    schema: 2,
    acceptedPlan: migratedPlan,
    readiness: {
      ...value.readiness,
      improvement: {
        ...improvementProjection(posture),
        autonomyMode,
        writes,
      },
    },
  };
  return isOperation(migrated) ? migrated : null;
}

function legacyPosture(
  mode: "passive" | "supervised" | "autonomous",
): ScopeImprovementPosture {
  if (mode === "passive") return "observe";
  if (mode === "supervised") return "propose";
  return "build";
}

function improvementProjection(posture: ScopeImprovementPosture): {
  posture: ScopeImprovementPosture;
  review: "owner-questions" | "task-proposals";
  builder: "disabled" | "enabled";
} {
  return {
    posture,
    review: posture === "observe" ? "owner-questions" : "task-proposals",
    builder: posture === "build" ? "enabled" : "disabled",
  };
}

function isImprovementProjection(
  value: Record<string, unknown>,
  posture?: ScopeImprovementPosture,
): boolean {
  if (!isImprovementPosture(value.posture)) return false;
  if (posture !== undefined) {
    const expected = improvementProjection(posture);
    return value.posture === expected.posture &&
      value.review === expected.review &&
      value.builder === expected.builder;
  }
  if (
    value.review !== "disabled" &&
    value.review !== "owner-questions" &&
    value.review !== "task-proposals"
  ) return false;
  return value.builder === "disabled" || value.builder === "enabled";
}

function postureAutonomyMode(
  posture: ScopeImprovementPosture,
): "passive" | "supervised" | "autonomous" {
  if (posture === "observe") return "passive";
  if (posture === "propose") return "supervised";
  return "autonomous";
}

function isLegacyAutonomyMode(
  value: unknown,
): value is "passive" | "supervised" | "autonomous" {
  return value === "passive" || value === "supervised" || value === "autonomous";
}

function isImprovementPosture(value: unknown): value is ScopeImprovementPosture {
  return value === "observe" || value === "propose" || value === "build";
}

function isWriteBoundary(value: unknown): value is ScopeWriteBoundary {
  if (!isRecord(value) || typeof value.mode !== "string") return false;
  if (
    value.mode === "none" ||
    value.mode === "scope-directory" ||
    value.mode === "unrestricted"
  ) {
    return true;
  }
  return value.mode === "paths" && Array.isArray(value.paths) && value.paths.length > 0 &&
    value.paths.every((path) =>
      typeof path === "string" && path.trim().length > 0
    );
}

function sameWriteBoundary(value: unknown, expected: ScopeWriteBoundary): boolean {
  return isWriteBoundary(value) && JSON.stringify(value) === JSON.stringify(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
