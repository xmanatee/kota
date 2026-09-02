import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import type { ModuleSetupStatusResponse } from "#core/modules/setup-requirements.js";
import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ScopeAuthorityOperatorAction } from "./scope-authority-operator-token.js";
import type { ScopeAuthorityService } from "./scope-authority-service.js";
import { resolveLiveDirectoryScope } from "./scope-directory.js";
import type { ScopeLifecycleService } from "./scope-lifecycle.js";
import { ScopeOnboardingOperationStore } from "./scope-onboarding-store.js";
import type {
  ScopeOnboardingApplyResult,
  ScopeOnboardingChange,
  ScopeOnboardingChoices,
  ScopeOnboardingInspection,
  ScopeOnboardingMutation,
  ScopeOnboardingNormalizedChoices,
  ScopeOnboardingOperation,
  ScopeOnboardingPlan,
  ScopeOnboardingPlanResult,
  ScopeOnboardingReadiness,
  ScopeOnboardingReason,
  ScopeOnboardingRuntimeDirectory,
} from "./scope-onboarding-types.js";
import type { ScopePolicyFragment, ScopeWriteBoundary } from "./scope-policy.js";
import type { ScopeRegistry } from "./scope-registry.js";

export type {
  ScopeOnboardingApplyResult,
  ScopeOnboardingChange,
  ScopeOnboardingChoices,
  ScopeOnboardingInspection,
  ScopeOnboardingOperation,
  ScopeOnboardingPlan,
  ScopeOnboardingPlanResult,
  ScopeOnboardingReadiness,
} from "./scope-onboarding-types.js";

export type ScopeOnboardingServiceOptions = {
  stateDir: string;
  registry: ScopeRegistry;
  lifecycle: ScopeLifecycleService;
  authority: ScopeAuthorityService;
  getSetupStatus: (
    directoryRoot: string,
    scopeId: string | undefined,
  ) => Promise<ModuleSetupStatusResponse>;
  isInitialImprovementAvailable: (scopeId: string) => boolean;
  isDispatchAvailable?: () => boolean;
  createRuntimeDirectory?: (path: string) => void;
  now?: () => Date;
};

/** One inspect/plan/apply transaction boundary for external directory scopes. */
export class ScopeOnboardingService {
  readonly #store: ScopeOnboardingOperationStore;
  readonly #now: () => Date;
  readonly #tails = new Map<string, Promise<void>>();

  constructor(private readonly options: ScopeOnboardingServiceOptions) {
    this.#store = new ScopeOnboardingOperationStore(options.stateDir);
    this.#now = options.now ?? (() => new Date());
  }

  async inspect(directoryRoot: string): Promise<ScopeOnboardingInspection> {
    const resolved = resolveLiveDirectoryScope({ scopeRoot: directoryRoot });
    if (!resolved.ok) throw new ScopeOnboardingInspectionError(resolved.reason, resolved.message);
    const scope = resolved.scope;
    const registered = this.options.registry.getByRoot(scope.scopeRoot);
    const blockers: ScopeOnboardingReason[] = [];
    for (const path of conflictingRuntimeDirectories(scope.scopeRoot)) {
      blockers.push({
        code: "runtime_path_conflict",
        capability: "scope-runtime",
        message: `Runtime path ${path} already exists but is not a real directory.`,
      });
    }
    const repositoryRoot = gitRepositoryRoot(scope.scopeRoot);
    const kind = repositoryRoot !== null
      ? "git-repository" as const
      : "directory" as const;
    if (repositoryRoot !== null && repositoryRoot !== scope.scopeRoot) {
      blockers.push(repositoryRootRequired(repositoryRoot));
    }
    let setup: ModuleSetupStatusResponse;
    try {
      setup = await this.options.getSetupStatus(
        scope.scopeRoot,
        registered?.scopeId,
      );
    } catch (error) {
      setup = {
        visibility: "full",
        requirements: [],
        summary: {
          ready: 0,
          missing: 0,
          pending: 0,
          expired: 0,
          revoked: 0,
          unknown: 1,
          unavailable: 0,
        },
      };
      blockers.push({
        code: "setup_inspection_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    for (const requirement of setup.requirements) {
      if (requirement.required && requirement.state !== "ready") {
        blockers.push({
          code: `setup_${requirement.state}`,
          capability: `${requirement.moduleName}.${requirement.requirementId}`,
          message: requirement.message,
        });
      }
    }
    const authority = registered
      ? this.options.authority.inspect(registered.scopeId)
      : null;
    const authorityView = authority && "resolvedPolicy" in authority ? authority : null;
    const policyRevision = authorityView?.revision ?? this.options.authority.currentRevision();
    const hostingState = registered
      ? this.options.lifecycle.getHostingState(registered.scopeId)
      : null;
    const inspectionFacts = {
      scopeId: scope.scopeId,
      directoryRoot: scope.scopeRoot,
      displayName: registered?.displayName ?? scope.displayName,
      kind,
      registered: registered !== undefined,
      hostingState,
      authority: authorityView === null
        ? { revision: policyRevision, trusted: false, policyFragment: null, resolvedPolicy: null }
        : {
            revision: authorityView.revision,
            trusted: authorityView.trust.trusted,
            policyFragment: authorityView.policyFragment,
            resolvedPolicy: authorityView.resolvedPolicy,
          },
      existing: existingState(scope.scopeRoot),
      setup: setup.requirements.map((entry) => ({
        moduleName: entry.moduleName,
        requirementId: entry.requirementId,
        state: entry.state,
      })),
      blockers,
    };
    return {
      inspectionId: digest(inspectionFacts),
      operationId: operationId(scope.scopeRoot),
      scopeId: scope.scopeId,
      directoryRoot: scope.scopeRoot,
      displayName: registered?.displayName ?? scope.displayName,
      kind,
      registered: registered !== undefined,
      hostingState,
      trust: authorityView?.trust ?? null,
      policyRevision,
      policyFragment: authorityView?.policyFragment ?? null,
      policy: authorityView?.resolvedPolicy ?? null,
      existing: inspectionFacts.existing,
      setup: setup.requirements,
      blockers,
    };
  }

  async plan(
    directoryRoot: string,
    choices: ScopeOnboardingChoices = {},
  ): Promise<ScopeOnboardingPlanResult> {
    let inspection: ScopeOnboardingInspection;
    try {
      inspection = await this.inspect(directoryRoot);
    } catch (error) {
      return {
        ok: false,
        reason: "invalid_directory",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const normalized = normalizeChoices(inspection, choices);
    if (!normalized.ok) return normalized;
    const blockers = [...inspection.blockers];
    const repositoryRootBlocker = blockers.find(
      (blocker) => blocker.code === "repository_root_required",
    );
    if (repositoryRootBlocker !== undefined) {
      return {
        ok: false,
        reason: "invalid_directory",
        message: repositoryRootBlocker.message,
      };
    }
    if (inspection.kind !== "git-repository") {
      blockers.push(repositoryWriteUnavailable());
    }
    const changes: ScopeOnboardingChange[] = [];
    if (!inspection.registered) {
      changes.push({
        owner: "machine",
        kind: "register-scope",
        scopeId: inspection.scopeId,
      });
    }
    if (inspection.registered && normalized.choices.displayName !== inspection.displayName) {
      changes.push({
        owner: "machine",
        kind: "update-display-name",
        scopeId: inspection.scopeId,
        displayName: normalized.choices.displayName,
      });
    }
    for (const path of missingRuntimeDirectories(inspection.directoryRoot)) {
      changes.push({ owner: "scope", kind: "create-runtime-directory", path });
    }
    changes.push({
      owner: "machine",
      kind: "set-authority",
      scopeId: inspection.scopeId,
      trust: normalized.choices.trust,
      initialAutomationMode: normalized.choices.initialAutomationMode,
      writes: normalized.choices.writes,
    });
    const stablePlan = {
      schema: 1 as const,
      operationId: inspection.operationId,
      inspectionId: inspection.inspectionId,
      scopeId: inspection.scopeId,
      directoryRoot: inspection.directoryRoot,
      choices: normalized.choices,
      registrationBaseline: {
        registered: inspection.registered,
        displayName: inspection.displayName,
        hostingState: inspection.hostingState,
      },
      authorityBaseline: {
        revision: inspection.policyRevision,
        trusted: inspection.trust?.trusted ?? false,
        policyFragment: inspection.policyFragment,
      },
      changes,
      blockers,
    };
    const plan: ScopeOnboardingPlan = {
      ...stablePlan,
      planId: `plan_${digest(stablePlan).slice(0, 24)}`,
      createdAt: this.#now().toISOString(),
      permissions: {
        trusted: normalized.choices.trust,
        autonomy: normalized.choices.initialAutomationMode,
        writes: normalized.choices.writes,
      },
    };
    return { ok: true, plan };
  }

  apply(
    plan: ScopeOnboardingPlan,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeOnboardingApplyResult> {
    const resolved = resolveLiveDirectoryScope({ scopeRoot: plan.directoryRoot });
    if (
      !resolved.ok ||
      plan.schema !== 1 ||
      plan.scopeId !== resolved.scope.scopeId ||
      plan.operationId !== operationId(resolved.scope.scopeRoot)
    ) {
      return Promise.resolve({
        ok: false,
        reason: "plan_changed",
        message: resolved.ok
          ? "Onboarding plan identity does not match its canonical directory"
          : resolved.message,
      });
    }
    return this.#serialize(plan.operationId, async () => {
      const current = this.#store.read(plan.operationId);
      if (current !== null && current.state !== "cancelled") {
        if (!sameAcceptedPlan(current.acceptedPlan, plan)) {
          return {
            ok: false,
            reason: "plan_changed",
            message: "A different onboarding plan is already recorded for this directory",
          };
        }
        if (current.state === "succeeded") {
          return { ok: true, operation: await this.#refreshSucceeded(current) };
        }
        return this.#execute(current, operatorAction);
      }
      const inspection = await this.inspect(plan.directoryRoot);
      if (inspection.scopeId !== plan.scopeId || inspection.inspectionId !== plan.inspectionId) {
        return {
          ok: false,
          reason: "plan_changed",
          message: "Scope state changed after this onboarding plan was created",
        };
      }
      const canonical = await this.plan(plan.directoryRoot, plan.choices);
      if (!canonical.ok || canonical.plan.planId !== plan.planId) {
        return {
          ok: false,
          reason: "plan_changed",
          message: canonical.ok
            ? "Onboarding plan contents do not match the canonical plan"
            : canonical.message,
        };
      }
      const acceptedPlan = {
        ...canonical.plan,
        createdAt: plan.createdAt,
      };
      const acceptedAt = this.#now().toISOString();
      const operation: ScopeOnboardingOperation = {
        schema: 1,
        operationId: acceptedPlan.operationId,
        state: "planned",
        acceptedPlan,
        attempts: 0,
        registeredByOperation: false,
        authorityRevision: acceptedPlan.authorityBaseline.revision,
        authorityApplied: null,
        displayNameBefore: null,
        mutations: [],
        readiness: readinessBeforeApply(acceptedPlan),
        provenance: {
          actor: "operator",
          acceptedAt,
          lastUpdatedAt: acceptedAt,
        },
        error: null,
      };
      this.#store.write(operation);
      return this.#execute(operation, operatorAction);
    });
  }

  async status(operationIdInput: string): Promise<ScopeOnboardingOperation | null> {
    const operation = this.#store.read(operationIdInput);
    if (operation === null || operation.state === "cancelled") return operation;
    if (operation.state === "succeeded") {
      return this.#serialize(operationIdInput, async () => {
        const current = this.#store.read(operationIdInput);
        return current?.state === "succeeded"
          ? this.#refreshSucceeded(current)
          : current;
      });
    }
    const reconciled = this.#reconcileAuthorityCheckpoint(operation, false);
    const projected = this.#update(reconciled, {
      readiness: await this.#readiness(reconciled, true),
    });
    if (!this.#tails.has(operationIdInput)) this.#store.write(projected);
    return projected;
  }

  isActivationAllowed(scopeId: string): boolean {
    const scope = this.options.registry.get(scopeId);
    if (!scope) return false;
    const operation = this.#store.read(operationId(scope.scopeRoot));
    return operation === null ||
      operation.state === "succeeded" ||
      operation.state === "cancelled";
  }

  /** Reconcile an interrupted transaction or pending success publication during startup. */
  recoverForStartup(scopeId: string): Promise<boolean> {
    const scope = this.options.registry.get(scopeId);
    if (!scope) return Promise.resolve(false);
    const operationIdInput = operationId(scope.scopeRoot);
    return this.#serialize(operationIdInput, async () => {
      let operation = this.#store.read(operationIdInput);
      if (operation === null || operation.state === "cancelled") return true;
      if (operation.state === "succeeded") {
        if (this.options.lifecycle.getHostingState(scopeId) === "hosted") {
          await this.#refreshSucceeded(operation);
        }
        return true;
      }

      operation = this.#reconcileAuthorityCheckpoint(operation);
      if (
        !operation.registeredByOperation &&
        operation.acceptedPlan.changes.some((change) => change.kind === "register-scope")
      ) {
        operation = this.#update(operation, { registeredByOperation: true });
        this.#store.write(operation);
      }

      if (operation.acceptedPlan.registrationBaseline.registered) {
        const rollback = await this.#rollback(operation);
        const readiness = await this.#readiness(
          rollback.operation,
          true,
        );
        const recovered = this.#update(rollback.operation, {
          state: "incomplete",
          readiness,
          error: rollback.failures.length === 0
            ? {
                code: "startup_recovered",
                message:
                  "Interrupted onboarding changes were restored to baseline; " +
                  "retry or cancel the operation.",
              }
            : {
                code: "rollback_failed",
                message:
                  `Interrupted onboarding could not be restored: ${rollback.failures.join("; ")}`,
              },
        });
        this.#store.write(recovered);
        return rollback.failures.length === 0;
      }

      const incomplete = this.#update(operation, {
        state: "incomplete",
        readiness: await this.#readiness(operation, true),
        error: {
          code: "startup_recovery_required",
          message: "Interrupted onboarding requires retry or cancellation before activation.",
        },
      });
      this.#store.write(incomplete);
      return false;
    });
  }

  retry(
    operationIdInput: string,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeOnboardingApplyResult> {
    return this.#serialize(operationIdInput, async () => {
      const operation = this.#store.read(operationIdInput);
      if (!operation) {
        return { ok: false, reason: "not_found", message: "Onboarding operation not found" };
      }
      if (operation.state === "succeeded") {
        return { ok: true, operation: await this.#refreshSucceeded(operation) };
      }
      if (operation.state === "cancelled") {
        return {
          ok: false,
          reason: "not_cancellable",
          message: "Cancelled onboarding operations cannot be retried",
          operation,
        };
      }
      return this.#execute(operation, operatorAction);
    });
  }

  cancel(operationIdInput: string): Promise<ScopeOnboardingApplyResult> {
    return this.#serialize(operationIdInput, async () => {
      const operation = this.#store.read(operationIdInput);
      if (!operation) {
        return { ok: false, reason: "not_found", message: "Onboarding operation not found" };
      }
      if (operation.state === "succeeded") {
        return {
          ok: false,
          reason: "not_cancellable",
          message: "A completed onboarding operation cannot be cancelled",
          operation,
        };
      }
      const rollback = await this.#rollback(operation);
      const readiness = await this.#readiness(rollback.operation, rollback.failures.length > 0);
      if (rollback.failures.length > 0) {
        const message = `Scope onboarding rollback failed: ${rollback.failures.join("; ")}`;
        const incomplete = this.#update(rollback.operation, {
          state: "incomplete",
          error: { code: "rollback_failed", message },
          readiness,
        });
        this.#store.write(incomplete);
        return {
          ok: false,
          reason: "rollback_failed",
          message,
          operation: incomplete,
        };
      }
      const cancelled = this.#update(rollback.operation, {
        state: "cancelled",
        error: null,
        readiness,
      });
      this.#store.write(cancelled);
      return { ok: true, operation: cancelled };
    });
  }

  async #execute(
    prior: ScopeOnboardingOperation,
    operatorAction: ScopeAuthorityOperatorAction | undefined,
  ): Promise<ScopeOnboardingApplyResult> {
    let operation = this.#update(prior, {
      state: "applying",
      attempts: prior.attempts + 1,
      error: null,
    });
    this.#store.write(operation);
    try {
      const resolved = resolveLiveDirectoryScope({
        scopeRoot: operation.acceptedPlan.directoryRoot,
      });
      if (
        !resolved.ok ||
        resolved.scope.scopeId !== operation.acceptedPlan.scopeId ||
        resolved.scope.scopeRoot !== operation.acceptedPlan.directoryRoot
      ) {
        throw new OnboardingApplyError(
          "scope_path_changed",
          resolved.ok
            ? "The selected scope directory no longer resolves to the accepted plan"
            : resolved.message,
        );
      }
      if (this.options.isDispatchAvailable?.() === false) {
        throw new OnboardingApplyError(
          "daemon_dispatch_paused",
          "Daemon workflow dispatch is globally paused; retry onboarding after recovery",
        );
      }
      const repositoryRoot = gitRepositoryRoot(operation.acceptedPlan.directoryRoot);
      if (
        repositoryRoot !== null &&
        repositoryRoot !== operation.acceptedPlan.directoryRoot
      ) {
        const blocker = repositoryRootRequired(repositoryRoot);
        throw new OnboardingApplyError(blocker.code, blocker.message);
      }
      const runtimePathConflict = operation.acceptedPlan.blockers.find(
        (blocker) => blocker.code === "runtime_path_conflict",
      );
      if (runtimePathConflict !== undefined) {
        throw new OnboardingApplyError(
          runtimePathConflict.code,
          runtimePathConflict.message,
        );
      }
      operation = this.#initializeScopeState(operation);
      const existing = this.options.registry.getByRoot(operation.acceptedPlan.directoryRoot);
      const registrationBaseline = operation.acceptedPlan.registrationBaseline;
      if (registrationBaseline.registered) {
        if (
          existing === undefined ||
          existing.scopeId !== operation.acceptedPlan.scopeId
        ) {
          throw new OnboardingApplyError(
            "plan_changed",
            "Scope registration changed after this onboarding plan was accepted",
          );
        }
        if (
          (
            operation.displayNameBefore === null &&
            existing.displayName !== registrationBaseline.displayName
          ) ||
          this.options.lifecycle.getHostingState(operation.acceptedPlan.scopeId) !==
            registrationBaseline.hostingState
        ) {
          throw new OnboardingApplyError(
            "plan_changed",
            "Scope registration changed after this onboarding plan was accepted",
          );
        }
      }
      if (!existing) {
        // Persist ownership before the registry/runtime transaction. A daemon
        // restart can then recognize and resume a registration committed in
        // the narrow interval before the lifecycle call returns.
        operation = this.#update(operation, { registeredByOperation: true });
        this.#store.write(operation);
        const prepared = await this.options.lifecycle.prepareDirectoryScopeRegistration({
          directoryRoot: operation.acceptedPlan.directoryRoot,
          displayName: operation.acceptedPlan.choices.displayName,
        });
        if (!prepared.ok) throw new OnboardingApplyError(prepared.reason, prepared.message);
        operation = this.#append(operation, {
          kind: "register-scope",
          target: prepared.scope.scopeId,
          status: "applied",
          at: this.#now().toISOString(),
        });
      } else if (existing.scopeId !== operation.acceptedPlan.scopeId) {
        throw new OnboardingApplyError(
          "duplicate_scope",
          `Directory is registered as unexpected scope ${existing.scopeId}`,
        );
      } else {
        if (
          !operation.registeredByOperation &&
          operation.acceptedPlan.changes.some((change) => change.kind === "register-scope")
        ) {
          // Reconcile artifacts written by a process that stopped after the
          // registry commit but before checkpointing the lifecycle result.
          operation = this.#update(operation, { registeredByOperation: true });
          this.#store.write(operation);
        }
        operation = this.#append(operation, {
          kind: "register-scope",
          target: existing.scopeId,
          status: "unchanged",
          at: this.#now().toISOString(),
        });
      }

      const registered = this.options.registry.get(operation.acceptedPlan.scopeId);
      if (!registered) {
        throw new OnboardingApplyError("unknown_scope", "Onboarding registration disappeared");
      }
      if (registered.displayName !== operation.acceptedPlan.choices.displayName) {
        if (operation.displayNameBefore === null) {
          operation = this.#update(operation, { displayNameBefore: registered.displayName });
          this.#store.write(operation);
        }
        const renamed = await this.options.lifecycle.updateDisplayName(
          operation.acceptedPlan.scopeId,
          operation.acceptedPlan.choices.displayName,
        );
        if (!renamed.ok) throw new OnboardingApplyError(renamed.reason, renamed.message);
        operation = this.#append(operation, {
          kind: "update-display-name",
          target: operation.acceptedPlan.scopeId,
          status: renamed.status === "unchanged" ? "unchanged" : "applied",
          at: this.#now().toISOString(),
        });
      }

      operation = this.#reconcileAuthorityCheckpoint(operation);
      const authority = this.options.authority.inspect(operation.acceptedPlan.scopeId);
      if (!("resolvedPolicy" in authority)) {
        throw new OnboardingApplyError(authority.reason, authority.message);
      }
      const desiredPolicy = onboardingAuthorityPolicy(operation.acceptedPlan);
      const authorityMatches = authority.trust.trusted === operation.acceptedPlan.choices.trust &&
        JSON.stringify(authority.policyFragment) === JSON.stringify(desiredPolicy);
      if (!authorityMatches) {
        const baselineMatches =
          authority.revision === operation.authorityRevision &&
          authority.trust.trusted === operation.acceptedPlan.authorityBaseline.trusted &&
          JSON.stringify(authority.policyFragment) ===
            JSON.stringify(operation.acceptedPlan.authorityBaseline.policyFragment);
        if (!baselineMatches) {
          throw new OnboardingApplyError(
            "plan_changed",
            "Scope authority changed after this onboarding plan was accepted",
          );
        }
        const applied = await this.options.authority.applyTransactional(
          operation.acceptedPlan.scopeId,
          {
            expectedRevision: authority.revision,
            reason:
              `Apply accepted external scope onboarding plan ${operation.acceptedPlan.planId}`,
            trust: operation.acceptedPlan.choices.trust,
            policy: desiredPolicy,
          },
          operatorAction,
        );
        if (!applied.ok) {
          throw new OnboardingApplyError(applied.reason, applied.message);
        }
        if (applied.status === "applied" && applied.auditRecord === undefined) {
          throw new OnboardingApplyError("apply_failed", "Authority commit omitted its audit receipt");
        }
        operation = this.#append(operation, {
          kind: "set-authority",
          target: operation.acceptedPlan.scopeId,
          status: applied.status === "unchanged" ? "unchanged" : "applied",
          at: this.#now().toISOString(),
        }, applied.status === "applied"
          ? {
              authorityRevision: applied.authority.revision,
              authorityApplied: {
                revision: applied.authority.revision,
                auditId: applied.auditRecord!.id,
              },
            }
          : { authorityRevision: applied.authority.revision });
      } else {
        if (
          authority.revision !== operation.authorityRevision &&
          operation.authorityApplied === null
        ) {
          const latestAudit = authority.audit.at(-1);
          const expectedReason =
            `Apply accepted external scope onboarding plan ${operation.acceptedPlan.planId}`;
          if (latestAudit?.reason !== expectedReason || latestAudit.revision !== authority.revision) {
            throw new OnboardingApplyError(
              "plan_changed",
              "Scope authority changed outside this onboarding operation",
            );
          }
          operation = this.#update(operation, {
            authorityRevision: authority.revision,
            authorityApplied: { revision: authority.revision, auditId: latestAudit.id },
          });
          this.#store.write(operation);
        }
        operation = this.#append(operation, {
          kind: "set-authority",
          target: operation.acceptedPlan.scopeId,
          status: "unchanged",
          at: this.#now().toISOString(),
        });
      }

      if (operation.registeredByOperation) {
        const activated = await this.options.lifecycle.activatePreparedScope(
          operation.acceptedPlan.scopeId,
        );
        if (!activated.ok) throw new OnboardingApplyError(activated.reason, activated.message);
        operation = this.#append(operation, {
          kind: "activate-scope",
          target: operation.acceptedPlan.scopeId,
          status: activated.status === "unchanged" ? "unchanged" : "applied",
          at: this.#now().toISOString(),
        });
      }
      const readiness = await this.#readiness(operation, false);
      operation = this.#update(operation, {
        state: "succeeded",
        readiness,
        displayNameBefore: null,
      });
      this.#store.write(operation);
      operation = await this.#refreshSucceeded(operation);
      return { ok: true, operation };
    } catch (error) {
      const failure = error instanceof OnboardingApplyError
        ? error
        : new OnboardingApplyError(
          "apply_failed",
          error instanceof Error ? error.message : String(error),
        );
      const rollback = await this.#rollback(operation);
      const readiness = await this.#readiness(rollback.operation, true);
      const rollbackMessage = rollback.failures.length === 0
        ? null
        : `rollback failed: ${rollback.failures.join("; ")}`;
      const incomplete = this.#update(rollback.operation, {
        state: "incomplete",
        readiness,
        error: rollbackMessage === null
          ? { code: failure.code, message: failure.message }
          : {
              code: "rollback_failed",
              message: `${failure.message}; ${rollbackMessage}`,
            },
      });
      this.#store.write(incomplete);
      return {
        ok: false,
        reason: rollbackMessage !== null
          ? "rollback_failed"
          : failure.code === "operator_action_required"
            ? "operator_action_required"
            : failure.code === "plan_changed"
              ? "plan_changed"
              : failure.code === "repository_root_required"
                ? "blocked"
                : "apply_failed",
        message: incomplete.error?.message ?? failure.message,
        operation: incomplete,
      };
    }
  }

  async #rollback(operation: ScopeOnboardingOperation): Promise<{
    operation: ScopeOnboardingOperation;
    failures: string[];
  }> {
    let next = this.#reconcileAuthorityCheckpoint(operation);
    const failures: string[] = [];
    const activatedByOperation = next.registeredByOperation &&
      this.options.lifecycle.getHostingState(operation.acceptedPlan.scopeId) === "hosted";
    if (activatedByOperation) {
      const deactivated = await this.options.lifecycle.deactivatePreparedScope(
        operation.acceptedPlan.scopeId,
      );
      if (!deactivated.ok) failures.push(deactivated.message);
      next = this.#append(next, {
        kind: "rollback",
        target: `activation:${operation.acceptedPlan.scopeId}`,
        status: deactivated.ok ? "rolled-back" : "failed",
        at: this.#now().toISOString(),
        ...(!deactivated.ok ? { message: deactivated.message } : {}),
      });
      if (!deactivated.ok) return { operation: next, failures };
    }
    if (next.authorityApplied !== null) {
      const compensated = await this.options.authority.compensate(
        operation.acceptedPlan.scopeId,
        {
          expectedRevision: next.authorityApplied.revision,
          expectedAuditId: next.authorityApplied.auditId,
          reason: `Roll back external scope onboarding plan ${operation.acceptedPlan.planId}`,
          trust: operation.acceptedPlan.authorityBaseline.trusted,
          policy: operation.acceptedPlan.authorityBaseline.policyFragment,
        },
      );
      if (!compensated.ok) {
        failures.push(compensated.message);
        next = this.#append(next, {
          kind: "rollback-authority",
          target: operation.acceptedPlan.scopeId,
          status: "failed",
          at: this.#now().toISOString(),
          message: compensated.message,
        });
        return { operation: next, failures };
      }
      next = this.#append(next, {
        kind: "rollback-authority",
        target: operation.acceptedPlan.scopeId,
        status: "rolled-back",
        at: this.#now().toISOString(),
      }, {
        authorityRevision: compensated.authority.revision,
        authorityApplied: null,
      });
    }
    if (next.displayNameBefore !== null && !next.registeredByOperation) {
      const restored = await this.options.lifecycle.updateDisplayName(
        operation.acceptedPlan.scopeId,
        next.displayNameBefore,
      );
      if (!restored.ok) {
        failures.push(restored.message);
        next = this.#append(next, {
          kind: "rollback",
          target: `display-name:${operation.acceptedPlan.scopeId}`,
          status: "failed",
          at: this.#now().toISOString(),
          message: restored.message,
        });
        return { operation: next, failures };
      }
      next = this.#append(next, {
        kind: "rollback",
        target: `display-name:${operation.acceptedPlan.scopeId}`,
        status: "rolled-back",
        at: this.#now().toISOString(),
      }, { displayNameBefore: null });
    }
    if (operation.registeredByOperation) {
      if (this.options.registry.get(operation.acceptedPlan.scopeId) === undefined) {
        next = this.#update(next, { registeredByOperation: false });
        this.#store.write(next);
      } else if (
        this.options.lifecycle.getHostingState(operation.acceptedPlan.scopeId) !== "inactive"
      ) {
        const message =
          `Scope ${operation.acceptedPlan.scopeId} is not an inactive prepared registration`;
        failures.push(message);
        next = this.#append(next, {
          kind: "rollback",
          target: operation.acceptedPlan.scopeId,
          status: "failed",
          at: this.#now().toISOString(),
          message,
        });
      } else {
        const result = await this.options.lifecycle.rollbackPreparedScope(
          operation.acceptedPlan.scopeId,
        );
        if (!result.ok) failures.push(result.message);
        next = this.#append(next, {
          kind: "rollback",
          target: operation.acceptedPlan.scopeId,
          status: result.ok ? "rolled-back" : "failed",
          at: this.#now().toISOString(),
          ...(!result.ok ? { message: result.message } : {}),
        }, result.ok ? { registeredByOperation: false } : {});
      }
    }
    if (!next.registeredByOperation) {
      next = this.#rollbackScopeState(next, failures);
    }
    return { operation: next, failures };
  }

  #initializeScopeState(
    operation: ScopeOnboardingOperation,
  ): ScopeOnboardingOperation {
    let next = operation;
    for (const change of operation.acceptedPlan.changes) {
      if (change.owner !== "scope") continue;
      const target = join(operation.acceptedPlan.directoryRoot, change.path);
      let ownership = runtimeDirectoryOwnership(next, change.path);
      const pathState = runtimeDirectoryState(target);
      if (pathState === "directory") {
        if (ownership === "unclaimed") {
          throw new OnboardingApplyError(
            "plan_changed",
            `Planned runtime directory ${change.path} was created after inspection`,
          );
        }
      } else if (pathState === "conflict") {
        throw new OnboardingApplyError(
          "runtime_path_conflict",
          `Planned runtime path ${change.path} exists but is not a real directory`,
        );
      } else {
        if (ownership === "unclaimed") {
          next = this.#append(next, {
            kind: "create-runtime-directory",
            target: change.path,
            status: "prepared",
            at: this.#now().toISOString(),
          });
          ownership = "prepared";
        }
        (this.options.createRuntimeDirectory ?? mkdirSync)(target);
      }
      if (ownership === "prepared") {
        next = this.#append(next, {
          kind: "create-runtime-directory",
          target: change.path,
          status: "applied",
          at: this.#now().toISOString(),
        });
      }
    }
    return next;
  }

  #rollbackScopeState(
    operation: ScopeOnboardingOperation,
    failures: string[],
  ): ScopeOnboardingOperation {
    let next = operation;
    const changes = operation.acceptedPlan.changes
      .filter((change) => change.owner === "scope")
      .reverse();
    for (const change of changes) {
      if (!ownsRuntimeDirectory(next, change.path)) continue;
      const target = join(operation.acceptedPlan.directoryRoot, change.path);
      if (runtimeDirectoryState(target) === "conflict") {
        next = this.#append(next, {
          kind: "rollback",
          target: `runtime-directory:${change.path}`,
          status: "rolled-back",
          at: this.#now().toISOString(),
          message: "Released transaction ownership without deleting a conflicting path",
        });
        continue;
      }
      try {
        rmdirSync(target);
        next = this.#append(next, {
          kind: "rollback",
          target: `runtime-directory:${change.path}`,
          status: "rolled-back",
          at: this.#now().toISOString(),
        });
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code === "ENOENT") {
          next = this.#append(next, {
            kind: "rollback",
            target: `runtime-directory:${change.path}`,
            status: "rolled-back",
            at: this.#now().toISOString(),
          });
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`runtime directory ${change.path}: ${message}`);
        next = this.#append(next, {
          kind: "rollback",
          target: `runtime-directory:${change.path}`,
          status: "failed",
          at: this.#now().toISOString(),
          message,
        });
      }
    }
    return next;
  }

  async #readiness(
    operation: ScopeOnboardingOperation,
    incomplete: boolean,
  ): Promise<ScopeOnboardingReadiness> {
    const plan = operation.acceptedPlan;
    const registered = this.options.registry.get(plan.scopeId);
    const authority = registered ? this.options.authority.inspect(plan.scopeId) : null;
    const trusted = authority !== null && "resolvedPolicy" in authority
      ? authority.trust.trusted
      : false;
    let setup: ModuleSetupStatusResponse | null = null;
    const reasons: ScopeOnboardingReason[] = [];
    try {
      setup = await this.options.getSetupStatus(plan.directoryRoot, registered?.scopeId);
      for (const requirement of setup.requirements) {
        if (requirement.required && requirement.state !== "ready") {
          reasons.push({
            code: `setup_${requirement.state}`,
            capability: `${requirement.moduleName}.${requirement.requirementId}`,
            message: requirement.message,
          });
        }
      }
    } catch (error) {
      reasons.push({
        code: "setup_inspection_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!trusted) {
      reasons.push({
        code: "scope_untrusted",
        message: "The scope remains untrusted until an operator explicitly grants trust.",
      });
    }
    if (
      authority !== null &&
      "resolvedPolicy" in authority &&
      authority.resolvedPolicy.writes.mode === "none"
    ) {
      reasons.push({
        code: "scope_improver_write_denied",
        capability: "scope-improver",
        message: "The resolved scope policy denies the repository writes required by scope-improver.",
      });
    }
    if (
      authority !== null &&
      "resolvedPolicy" in authority &&
      authority.resolvedPolicy.autonomy.maxMode === "passive"
    ) {
      reasons.push({
        code: "scope_improver_passive",
        capability: "scope-improver",
        message: "Passive autonomy is read-only; choose supervised or autonomous mode to run scope-improver.",
      });
    }
    const repositoryRoot = gitRepositoryRoot(plan.directoryRoot);
    if (repositoryRoot === null) {
      reasons.push(repositoryWriteUnavailable());
    } else if (repositoryRoot !== plan.directoryRoot) {
      reasons.push(repositoryRootRequired(repositoryRoot));
    }
    const configured = isRealDirectory(join(plan.directoryRoot, ".kota"));
    if (!configured) {
      reasons.push({
        code: "scope_state_incomplete",
        message: "The canonical scope runtime has not initialized its KOTA state.",
      });
    }
    const hosted = registered !== undefined &&
      this.options.lifecycle.getHostingState(plan.scopeId) === "hosted";
    if (registered !== undefined && !hosted) {
      reasons.push({
        code: "scope_not_active",
        message: "The registered scope runtime is dispatch-closed until onboarding completes.",
      });
    }
    let workflowAvailable = false;
    if (registered !== undefined) {
      try {
        workflowAvailable = this.options.isInitialImprovementAvailable(plan.scopeId);
      } catch (error) {
        reasons.push({
          code: "workflow_inspection_failed",
          capability: "scope-improver",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!workflowAvailable) {
      reasons.push({
        code: "workflow_unavailable",
        capability: "scope-improver",
        message:
          "The initial scope-improvement onboarding chain and scope-improver must both be enabled.",
      });
    }
    if (this.options.isDispatchAvailable?.() === false) {
      reasons.push({
        code: "daemon_dispatch_paused",
        capability: "scope-improver",
        message: "Daemon workflow dispatch is globally paused pending recovery.",
      });
    }
    if (incomplete) {
      reasons.push({
        code: "onboarding_incomplete",
        message: "The onboarding transaction is incomplete and requires retry or cancellation.",
      });
    }
    return {
      scopeId: plan.scopeId,
      directoryRoot: plan.directoryRoot,
      registered: registered !== undefined,
      configured,
      trusted,
      workflowReady: hosted && configured && trusted && workflowAvailable && reasons.length === 0,
      blocked: reasons.length > 0,
      partiallyApplied: incomplete && (
        operation.registeredByOperation ||
        operation.authorityApplied !== null ||
        operation.displayNameBefore !== null ||
        operation.acceptedPlan.changes.some((change) =>
          change.owner === "scope" && ownsRuntimeDirectory(operation, change.path)
        )
      ),
      reasons,
    };
  }

  async #refreshSucceeded(
    operation: ScopeOnboardingOperation,
  ): Promise<ScopeOnboardingOperation> {
    let next = operation;
    let readiness = await this.#readiness(next, false);
    const completionPublished = next.mutations.some((mutation) =>
      mutation.kind === "complete-onboarding" && mutation.status === "applied"
    );
    if (readiness.workflowReady && !completionPublished) {
      const publicationId = onboardingCompletionId(next.operationId);
      const completionPrepared = next.mutations.some((mutation) =>
        mutation.kind === "complete-onboarding" && mutation.status === "prepared"
      );
      if (!completionPrepared) {
        next = this.#append(next, {
          kind: "complete-onboarding",
          target: publicationId,
          status: "prepared",
          at: this.#now().toISOString(),
        });
      }
      try {
        this.options.lifecycle.completeOnboarding(next.acceptedPlan.scopeId, publicationId);
        next = this.#append(next, {
          kind: "complete-onboarding",
          target: publicationId,
          status: "applied",
          at: this.#now().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        next = this.#append(next, {
          kind: "complete-onboarding",
          target: publicationId,
          status: "failed",
          at: this.#now().toISOString(),
          message,
        });
        readiness = {
          ...readiness,
          workflowReady: false,
          blocked: true,
          reasons: [...readiness.reasons, {
            code: "onboarding_completion_failed",
            capability: "scope-improver",
            message: `The initial improvement boundary could not be published: ${message}`,
          }],
        };
      }
    }
    next = this.#update(next, { readiness });
    this.#store.write(next);
    return next;
  }

  #append(
    operation: ScopeOnboardingOperation,
    mutation: ScopeOnboardingMutation,
    fields: Partial<Pick<
      ScopeOnboardingOperation,
      | "registeredByOperation"
      | "authorityRevision"
      | "authorityApplied"
      | "displayNameBefore"
    >> = {},
  ): ScopeOnboardingOperation {
    const next = this.#update(operation, {
      ...fields,
      mutations: [...operation.mutations, mutation],
    });
    this.#store.write(next);
    return next;
  }

  #update(
    operation: ScopeOnboardingOperation,
    fields: Partial<Omit<ScopeOnboardingOperation, "schema" | "operationId" | "provenance">>,
  ): ScopeOnboardingOperation {
    const next = {
      ...operation,
      ...fields,
      provenance: {
        ...operation.provenance,
        lastUpdatedAt: this.#now().toISOString(),
      },
    };
    if (
      fields.readiness !== undefined ||
      next.state === "succeeded" ||
      next.state === "cancelled"
    ) {
      return next;
    }
    return { ...next, readiness: this.#checkpointReadiness(next) };
  }

  #checkpointReadiness(operation: ScopeOnboardingOperation): ScopeOnboardingReadiness {
    const plan = operation.acceptedPlan;
    const registered = this.options.registry.get(plan.scopeId);
    const authority = registered === undefined
      ? null
      : this.options.authority.inspect(plan.scopeId);
    const trusted = authority !== null && "resolvedPolicy" in authority
      ? authority.trust.trusted
      : false;
    const configured = isRealDirectory(join(plan.directoryRoot, ".kota"));
    const partiallyApplied = operation.registeredByOperation ||
      operation.authorityApplied !== null ||
      operation.displayNameBefore !== null ||
      operation.acceptedPlan.changes.some((change) =>
        change.owner === "scope" && ownsRuntimeDirectory(operation, change.path)
      );
    return {
      scopeId: plan.scopeId,
      directoryRoot: plan.directoryRoot,
      registered: registered !== undefined,
      configured,
      trusted,
      workflowReady: false,
      blocked: true,
      partiallyApplied,
      reasons: [
        ...plan.blockers,
        {
          code: "onboarding_incomplete",
          message: "The onboarding transaction is incomplete and requires retry or cancellation.",
        },
      ],
    };
  }

  #reconcileAuthorityCheckpoint(
    operation: ScopeOnboardingOperation,
    persist = true,
  ): ScopeOnboardingOperation {
    const authority = this.options.authority.inspect(operation.acceptedPlan.scopeId);
    if (!("resolvedPolicy" in authority)) return operation;
    const latestAudit = authority.audit.at(-1);
    const desiredPolicy = onboardingAuthorityPolicy(operation.acceptedPlan);
    const applyReason =
      `Apply accepted external scope onboarding plan ${operation.acceptedPlan.planId}`;
    const baselineMatches =
      authority.trust.trusted === operation.acceptedPlan.authorityBaseline.trusted &&
      JSON.stringify(authority.policyFragment) ===
        JSON.stringify(operation.acceptedPlan.authorityBaseline.policyFragment);
    const desiredMatches = authority.trust.trusted === operation.acceptedPlan.choices.trust &&
      JSON.stringify(authority.policyFragment) === JSON.stringify(desiredPolicy);

    if (operation.authorityApplied !== null) {
      if (
        baselineMatches &&
        latestAudit?.policy.compensationOf === operation.authorityApplied.auditId
      ) {
        const reconciled = this.#update(operation, {
          authorityRevision: authority.revision,
          authorityApplied: null,
        });
        if (persist) this.#store.write(reconciled);
        return reconciled;
      }
      return operation;
    }

    if (
      desiredMatches &&
      latestAudit?.reason === applyReason &&
      latestAudit.policy.compensatable === true
    ) {
      const reconciled = this.#update(operation, {
        authorityRevision: authority.revision,
        authorityApplied: { revision: authority.revision, auditId: latestAudit.id },
      });
      if (persist) this.#store.write(reconciled);
      return reconciled;
    }

    if (baselineMatches && latestAudit?.policy.compensationOf !== undefined) {
      const compensated = authority.audit.find(
        (record) => record.id === latestAudit.policy.compensationOf,
      );
      if (compensated?.reason === applyReason) {
        const reconciled = this.#update(operation, {
          authorityRevision: authority.revision,
          authorityApplied: null,
        });
        if (persist) this.#store.write(reconciled);
        return reconciled;
      }
    }
    return operation;
  }

  #serialize<T>(operationIdInput: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(operationIdInput) ?? Promise.resolve();
    const result = previous.then(action, action);
    const tail = result.then(() => undefined, () => undefined);
    this.#tails.set(operationIdInput, tail);
    void tail.finally(() => {
      if (this.#tails.get(operationIdInput) === tail) this.#tails.delete(operationIdInput);
    });
    return result;
  }
}

export class ScopeOnboardingInspectionError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "ScopeOnboardingInspectionError";
  }
}

class OnboardingApplyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OnboardingApplyError";
  }
}

function normalizeChoices(
  inspection: ScopeOnboardingInspection,
  choices: ScopeOnboardingChoices,
):
  | { ok: true; choices: ScopeOnboardingNormalizedChoices }
  | { ok: false; reason: "invalid_choices"; message: string } {
  const displayName = (choices.displayName ?? inspection.displayName).trim();
  if (!displayName) {
    return { ok: false, reason: "invalid_choices", message: "Display name must not be empty" };
  }
  const initialAutomationMode = choices.initialAutomationMode ?? "passive";
  if (!isAutonomyMode(initialAutomationMode)) {
    return { ok: false, reason: "invalid_choices", message: "Invalid automation mode" };
  }
  const writes = choices.writes ?? { mode: "none" };
  if (!isWriteBoundary(writes)) {
    return { ok: false, reason: "invalid_choices", message: "Invalid scope write boundary" };
  }
  const trust = choices.trust ?? false;
  if (initialAutomationMode === "autonomous" && writes.mode !== "none" && !trust) {
    return {
      ok: false,
      reason: "invalid_choices",
      message: "Autonomous writes require an explicit trusted choice",
    };
  }
  return {
    ok: true,
    choices: { displayName, trust, initialAutomationMode, writes },
  };
}

function isWriteBoundary(value: ScopeWriteBoundary): boolean {
  if (value.mode === "none" || value.mode === "scope-directory" || value.mode === "unrestricted") {
    return true;
  }
  return value.mode === "paths" && value.paths.length > 0 &&
    value.paths.every((path) => path.trim().length > 0);
}

function existingState(directoryRoot: string): ScopeOnboardingInspection["existing"] {
  return {
    kotaState: isRealDirectory(join(directoryRoot, ".kota")),
    scopeConfig: isRealFile(join(directoryRoot, ".kota", "config.json")),
    taskQueue: isRealDirectory(join(directoryRoot, "data", "tasks")),
    inbox: isRealDirectory(join(directoryRoot, "data", "inbox")),
    guidance: ["AGENTS.md", "CLAUDE.md"].filter((name) =>
      isRealFile(join(directoryRoot, name)),
    ),
  };
}

const SCOPE_RUNTIME_DIRECTORIES = [
  ".kota",
  ".kota/runs",
  ".kota/approvals",
  ".kota/dead-letter-queue",
  ".kota/idempotency",
  ".kota/owner-decisions",
  ".kota/owner-questions",
] as const satisfies readonly ScopeOnboardingRuntimeDirectory[];

function missingRuntimeDirectories(directoryRoot: string): ScopeOnboardingRuntimeDirectory[] {
  return SCOPE_RUNTIME_DIRECTORIES.filter((path) =>
    runtimeDirectoryState(join(directoryRoot, path)) === "missing"
  );
}

function conflictingRuntimeDirectories(
  directoryRoot: string,
): ScopeOnboardingRuntimeDirectory[] {
  return SCOPE_RUNTIME_DIRECTORIES.filter((path) =>
    runtimeDirectoryState(join(directoryRoot, path)) === "conflict"
  );
}

function ownsRuntimeDirectory(
  operation: ScopeOnboardingOperation,
  path: ScopeOnboardingRuntimeDirectory,
): boolean {
  return runtimeDirectoryOwnership(operation, path) !== "unclaimed";
}

function runtimeDirectoryOwnership(
  operation: ScopeOnboardingOperation,
  path: ScopeOnboardingRuntimeDirectory,
): "unclaimed" | "prepared" | "applied" {
  let ownership: "unclaimed" | "prepared" | "applied" = "unclaimed";
  for (const mutation of operation.mutations) {
    if (mutation.kind === "create-runtime-directory" && mutation.target === path) {
      if (mutation.status === "prepared" || mutation.status === "applied") {
        ownership = mutation.status;
      }
    }
    if (mutation.kind === "rollback" && mutation.target === `runtime-directory:${path}`) {
      if (mutation.status === "rolled-back") ownership = "unclaimed";
    }
  }
  return ownership;
}

function gitRepositoryRoot(directoryRoot: string): string | null {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root.length > 0 ? realpathSync.native(root) : null;
  } catch {
    return null;
  }
}

function repositoryRootRequired(repositoryRoot: string): ScopeOnboardingReason {
  return {
    code: "repository_root_required",
    capability: "scope-improver",
    message:
      `Selected directory is nested inside Git repository ${repositoryRoot}. ` +
      "Select that repository root so the workflow sandbox and scope write boundary cover the same tree.",
  };
}

function repositoryWriteUnavailable(): ScopeOnboardingReason {
  return {
    code: "repository_write_unavailable",
    capability: "scope-improver",
    message:
      "scope-improver requires Git-backed repository writes; other directory capabilities remain available.",
  };
}

function isRealDirectory(path: string): boolean {
  return runtimeDirectoryState(path) === "directory";
}

function runtimeDirectoryState(path: string): "directory" | "missing" | "conflict" {
  try {
    const stats = lstatSync(path);
    return stats.isDirectory() && !stats.isSymbolicLink() ? "directory" : "conflict";
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "missing"
      : "conflict";
  }
}

function isRealFile(path: string): boolean {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function readinessBeforeApply(plan: ScopeOnboardingPlan): ScopeOnboardingReadiness {
  return {
    scopeId: plan.scopeId,
    directoryRoot: plan.directoryRoot,
    registered: false,
    configured: false,
    trusted: false,
    workflowReady: false,
    blocked: plan.blockers.length > 0,
    partiallyApplied: false,
    reasons: plan.blockers,
  };
}

function onboardingAuthorityPolicy(plan: ScopeOnboardingPlan): ScopePolicyFragment {
  return {
    ...(plan.authorityBaseline.policyFragment ?? {}),
    scopeId: plan.scopeId,
    reason: `Accepted onboarding plan ${plan.planId}`,
    autonomy: {
      defaultMode: plan.choices.initialAutomationMode,
      maxMode: plan.choices.initialAutomationMode,
    },
    writes: plan.choices.writes,
  };
}

function onboardingCompletionId(operationIdInput: string): string {
  return `scope-onboarding:${operationIdInput}:completed`;
}

function operationId(directoryRoot: string): string {
  return `onboard_${digest(["scope-onboarding-operation-v1", directoryRoot]).slice(0, 24)}`;
}

function sameAcceptedPlan(left: ScopeOnboardingPlan, right: ScopeOnboardingPlan): boolean {
  return left.planId === right.planId &&
    left.operationId === right.operationId &&
    left.inspectionId === right.inspectionId &&
    left.directoryRoot === right.directoryRoot &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.choices) === JSON.stringify(right.choices);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
