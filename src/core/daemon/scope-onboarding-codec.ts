import type {
  ScopeOnboardingAcceptedPlan,
  ScopeOnboardingChoices,
  ScopeOnboardingNormalizedChoices,
} from "./scope-onboarding-types.js";
import { decodeScopePolicyFragment } from "./scope-policy-codec.js";

type BoundaryObject = { [key: string]: unknown };
const OPERATION_ID = /^onboard_[a-f0-9]{24}$/;

export type ScopeOnboardingDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function decodeScopeOnboardingInspectionRequest(
  raw: unknown,
): ScopeOnboardingDecodeResult<{ directoryRoot: string }> {
  return decode(() => {
    const obj = objectValue(raw, "onboarding inspection");
    assertKeys(obj, "onboarding inspection", ["directoryRoot"]);
    return { directoryRoot: requiredString(obj.directoryRoot, "onboarding inspection.directoryRoot") };
  });
}

export function decodeScopeOnboardingPlanRequest(
  raw: unknown,
): ScopeOnboardingDecodeResult<{
  directoryRoot: string;
  choices: ScopeOnboardingChoices;
}> {
  return decode(() => {
    const obj = objectValue(raw, "onboarding plan request");
    assertKeys(obj, "onboarding plan request", ["directoryRoot", "choices"]);
    return {
      directoryRoot: requiredString(obj.directoryRoot, "onboarding plan request.directoryRoot"),
      choices: obj.choices === undefined
        ? {}
        : parseChoices(obj.choices, "onboarding plan request.choices", false),
    };
  });
}

export function decodeScopeOnboardingAcceptedPlan(
  raw: unknown,
): ScopeOnboardingDecodeResult<ScopeOnboardingAcceptedPlan> {
  return decode(() => {
    const obj = objectValue(raw, "accepted onboarding plan");
    assertKeys(obj, "accepted onboarding plan", [
      "planId",
      "operationId",
      "inspectionId",
      "directoryRoot",
      "createdAt",
      "choices",
    ]);
    const createdAt = requiredString(obj.createdAt, "accepted onboarding plan.createdAt");
    if (Number.isNaN(Date.parse(createdAt))) {
      throw new Error("accepted onboarding plan.createdAt must be an ISO date-time");
    }
    return {
      planId: requiredString(obj.planId, "accepted onboarding plan.planId"),
      operationId: onboardingOperationId(obj.operationId),
      inspectionId: requiredString(
        obj.inspectionId,
        "accepted onboarding plan.inspectionId",
      ),
      directoryRoot: requiredString(
        obj.directoryRoot,
        "accepted onboarding plan.directoryRoot",
      ),
      createdAt,
      choices: parseChoices(
        obj.choices,
        "accepted onboarding plan.choices",
        true,
      ) as ScopeOnboardingNormalizedChoices,
    };
  });
}

function parseChoices(
  raw: unknown,
  path: string,
  requireComplete: boolean,
): ScopeOnboardingChoices {
  const obj = objectValue(raw, path);
  assertKeys(obj, path, ["displayName", "trust", "improvementPosture", "writes"]);
  if (requireComplete) {
    for (const field of ["displayName", "trust", "improvementPosture", "writes"] as const) {
      if (obj[field] === undefined) throw new Error(`${path}.${field} is required`);
    }
  }
  if (obj.trust !== undefined && typeof obj.trust !== "boolean") {
    throw new Error(`${path}.trust must be a boolean`);
  }
  if (obj.improvementPosture !== undefined && !isImprovementPosture(obj.improvementPosture)) {
    throw new Error(`${path}.improvementPosture must be observe, propose, or build`);
  }
  let writes: ScopeOnboardingChoices["writes"];
  if (obj.writes !== undefined) {
    const decoded = decodeScopePolicyFragment({
      scopeId: "wire-validation",
      reason: "Validate onboarding write boundary",
      writes: obj.writes,
    });
    if (!decoded.ok || decoded.value.writes === undefined) {
      throw new Error(decoded.ok ? `${path}.writes is required` : decoded.error);
    }
    writes = decoded.value.writes;
  }
  return {
    ...(obj.displayName !== undefined
      ? { displayName: requiredString(obj.displayName, `${path}.displayName`) }
      : {}),
    ...(typeof obj.trust === "boolean" ? { trust: obj.trust } : {}),
    ...(isImprovementPosture(obj.improvementPosture)
      ? { improvementPosture: obj.improvementPosture }
      : {}),
    ...(writes !== undefined ? { writes } : {}),
  };
}

function isImprovementPosture(value: unknown): value is "observe" | "propose" | "build" {
  return value === "observe" || value === "propose" || value === "build";
}

function decode<T>(parse: () => T): ScopeOnboardingDecodeResult<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function objectValue(raw: unknown, path: string): BoundaryObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${path} must be an object`);
  }
  return raw as BoundaryObject;
}

function assertKeys(obj: BoundaryObject, path: string, allowed: readonly string[]): void {
  const unexpected = Object.keys(obj).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw new Error(`${path} has unknown field ${unexpected}`);
}

function requiredString(raw: unknown, path: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return raw;
}

function onboardingOperationId(raw: unknown): string {
  const value = requiredString(raw, "accepted onboarding plan.operationId");
  if (!OPERATION_ID.test(value)) {
    throw new Error("accepted onboarding plan.operationId is invalid");
  }
  return value;
}
