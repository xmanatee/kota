import type {
  ScopeOnboardingInspection,
  ScopeOnboardingOperation,
  ScopeOnboardingPlan,
} from "#core/daemon/scope-onboarding.js";
import type { ModuleSetupRequirementStatus } from "#core/modules/setup-requirements.js";

type OnboardingReason = ScopeOnboardingInspection["blockers"][number];
type OnboardingChange = ScopeOnboardingPlan["changes"][number];
type OnboardingMutation = ScopeOnboardingOperation["mutations"][number];

function describeReason(reason: OnboardingReason): string {
  const capability = reason.capability ? ` (${reason.capability})` : "";
  return `[${reason.code}]${capability} ${reason.message}`;
}

function describeSetup(requirement: ModuleSetupRequirementStatus): string {
  return `${requirement.moduleName}.${requirement.requirementId}=${requirement.state}: ${requirement.message}`;
}

function describeChange(change: OnboardingChange): string {
  switch (change.kind) {
    case "register-scope":
      return `register scope ${change.scopeId}`;
    case "update-display-name":
      return `set ${change.scopeId} display name to ${JSON.stringify(change.displayName)}`;
    case "set-authority":
      return `set ${change.scopeId} authority to trust=${change.trust}, improvement=${change.improvementPosture}, writes=${change.writes.mode}`;
    case "create-runtime-directory":
      return `create ${change.path}`;
  }
}

function describeMutation(mutation: OnboardingMutation): string {
  return `${mutation.kind} ${mutation.target}=${mutation.status}${mutation.message ? `: ${mutation.message}` : ""}`;
}

function describeMany<T>(
  values: readonly T[],
  describe: (value: T) => string,
): string {
  return values.length === 0 ? "none" : values.map(describe).join(" | ");
}

export function describeOnboardingInspection(
  inspection: ScopeOnboardingInspection,
): string[] {
  const setupGaps = inspection.setup.filter((requirement) => requirement.state !== "ready");
  const existing = inspection.existing;
  return [
    `Scope: ${inspection.displayName} (${inspection.scopeId}); operationId=${inspection.operationId}; directory=${inspection.directoryRoot}; kind=${inspection.kind}; registered=${inspection.registered}; hosting=${inspection.hostingState ?? "not-hosted"}; trust=${inspection.trust?.trusted === true ? "trusted" : "untrusted"}.`,
    `Existing: .kota=${existing.kotaState}; config=${existing.scopeConfig}; task-queue=${existing.taskQueue}; inbox=${existing.inbox}; guidance=${existing.guidance.length > 0 ? existing.guidance.join(", ") : "none"}.`,
    `Setup gaps: ${describeMany(setupGaps, describeSetup)}.`,
    `Blockers: ${describeMany(inspection.blockers, describeReason)}.`,
  ];
}

export function describeOnboardingPlan(plan: ScopeOnboardingPlan): string[] {
  return [
    `Plan ${plan.planId}: operationId=${plan.operationId}; directory=${plan.directoryRoot}; trust=${plan.permissions.trusted ? "trusted" : "untrusted"}; automation=${plan.permissions.autonomy}; writes=${plan.permissions.writes.mode}.`,
    `Changes: ${describeMany(plan.changes, describeChange)}.`,
    `Blockers: ${describeMany(plan.blockers, describeReason)}.`,
  ];
}

export function describeOnboardingOperation(
  operation: ScopeOnboardingOperation,
): string[] {
  const readiness = operation.readiness;
  return [
    `Operation ${operation.operationId}: state=${operation.state}; attempts=${operation.attempts}.`,
    `Readiness: registered=${readiness.registered}; configured=${readiness.configured}; trusted=${readiness.trusted}; workflow-ready=${readiness.workflowReady}; blocked=${readiness.blocked}; partially-applied=${readiness.partiallyApplied}.`,
    `Readiness reasons: ${describeMany(readiness.reasons, describeReason)}.`,
    `Mutations: ${describeMany(operation.mutations, describeMutation)}.`,
    `Error: ${operation.error ? describeReason(operation.error) : "none"}.`,
  ];
}
