import {
  collectScopeDrainBlockers,
  defaultScopeBlocker,
  runtimeStopBlocker,
} from "./scope-drain-blockers.js";
import type { ScopeDrainBlocker } from "./scope-drain-inspection.js";
import {
  requireScopeChannelAdmission,
  scopeRollbackFailure,
} from "./scope-lifecycle-errors.js";
import {
  setDefaultScope,
  updateScopeDisplayName,
} from "./scope-lifecycle-mutations.js";
import { ScopeLifecycleOperationQueue } from "./scope-lifecycle-operation-queue.js";
import {
  type DirectoryScopeRegistrationInput,
  persistenceFailure,
  registeredDirectoryScope,
  type ScopeDrainResult,
  type ScopeHostingState,
  type ScopeLifecycleOptions,
  type ScopeMutationResult,
  type ScopePreparedRegistrationMutationResult,
  type ScopePreparedRegistrationResult,
  type ScopeRegistrationResult,
  type ScopeRemovalResult,
  unknownScopeMutation,
} from "./scope-lifecycle-types.js";
import { registerDirectoryScope } from "./scope-registration.js";
import type { ScopeId } from "./scope-registry.js";

export type {
  DirectoryScopeRegistrationInput,
  RegisteredDirectoryScope,
  ScopeDrainResult,
  ScopeHostingState,
  ScopeLifecycleFailureReason,
  ScopeMutationResult,
  ScopePreparedRegistrationMutationResult,
  ScopePreparedRegistrationResult,
  ScopeRegistrationResult,
  ScopeRemovalResult,
} from "./scope-lifecycle-types.js";

/** Transactional live lifecycle over the one scope and runtime registries. */
export class ScopeLifecycleService {
  private readonly state = new Map<ScopeId, ScopeHostingState>();
  private readonly operations = new ScopeLifecycleOperationQueue();

  constructor(private readonly options: ScopeLifecycleOptions) {}

  registerDirectoryScope(
    input: DirectoryScopeRegistrationInput,
  ): Promise<ScopeRegistrationResult> {
    return this.operations.run(async () => {
      const result = await registerDirectoryScope(this.options, input);
      if (result.ok) this.state.set(result.scope.scopeId, "hosted");
      return result;
    });
  }

  /** Persist and host a new scope with dispatch closed until onboarding commits. */
  prepareDirectoryScopeRegistration(
    input: DirectoryScopeRegistrationInput,
  ): Promise<ScopePreparedRegistrationResult> {
    return this.operations.run(async () => {
      const result = await registerDirectoryScope(this.options, input, false);
      if (!result.ok) return result;
      this.state.set(result.scope.scopeId, "inactive");
      return { ok: true, status: "prepared", scope: result.scope };
    });
  }

  activatePreparedScope(scopeId: ScopeId): Promise<ScopePreparedRegistrationMutationResult> {
    return this.operations.run(async () => {
      const scope = this.options.registry.get(scopeId);
      if (!scope) return unknownScopeMutation(scopeId);
      const registered = registeredDirectoryScope(
        scope.scopeId,
        scope.scopeRoot,
        scope.displayName,
      );
      if (this.getHostingState(scopeId) === "hosted") {
        return { ok: true, status: "unchanged", scope: registered };
      }
      if (!this.options.runtimeHost.isHosted(scopeId)) {
        return {
          ok: false,
          reason: "scope_not_hosted",
          message: `Prepared scope ${scopeId} has no hosted runtime`,
          scopeId,
        };
      }
      const runtime = this.options.runtimes.get(scopeId);
      try {
        await this.options.runtimeHost.activatePrepared(runtime);
      } catch (error) {
        return {
          ok: false,
          reason: "runtime_start_failed",
          message: error instanceof Error ? error.message : String(error),
          scopeId,
        };
      }
      this.state.set(scopeId, "hosted");
      this.emit("registered", scopeId);
      return { ok: true, status: "activated", scope: registered };
    });
  }

  /** Close dispatch again so an activated onboarding registration can be compensated. */
  deactivatePreparedScope(scopeId: ScopeId): Promise<ScopePreparedRegistrationMutationResult> {
    return this.operations.run(async () => {
      const scope = this.options.registry.get(scopeId);
      if (!scope) return unknownScopeMutation(scopeId);
      const registered = registeredDirectoryScope(
        scope.scopeId,
        scope.scopeRoot,
        scope.displayName,
      );
      if (this.options.runtimeHost.isPrepared(scopeId)) {
        this.state.set(scopeId, "inactive");
        return { ok: true, status: "unchanged", scope: registered };
      }
      if (this.getHostingState(scopeId) !== "hosted") {
        return {
          ok: false,
          reason: "scope_not_hosted",
          message: `Activated onboarding scope ${scopeId} is not hosted`,
          scopeId,
        };
      }
      const runtime = this.options.runtimes.get(scopeId);
      try {
        await this.options.runtimeHost.deactivateToPrepared(runtime, 1, 1_000);
      } catch (error) {
        return {
          ok: false,
          reason: "runtime_update_failed",
          message: error instanceof Error ? error.message : String(error),
          scopeId,
        };
      }
      this.state.set(scopeId, "inactive");
      return { ok: true, status: "deactivated", scope: registered };
    });
  }

  /** Publish the committed onboarding boundary with its durable transaction identity. */
  completeOnboarding(scopeId: ScopeId, idempotencyKey: string): void {
    if (!idempotencyKey.trim()) {
      throw new Error("Onboarding completion idempotency key must not be empty");
    }
    const scope = this.options.registry.get(scopeId);
    if (!scope) throw new Error(`Cannot complete onboarding for unknown scope ${scopeId}`);
    this.options.bus.emit("scope.lifecycle.changed", {
      transition: "onboarding-completed",
      affectedScopeId: scopeId,
      directoryRoot: scope.scopeRoot,
      displayName: scope.displayName,
      idempotencyKey,
    }, idempotencyKey);
  }

  rollbackPreparedScope(scopeId: ScopeId): Promise<ScopePreparedRegistrationMutationResult> {
    return this.operations.run(async () => {
      const scope = this.options.registry.get(scopeId);
      if (!scope) return unknownScopeMutation(scopeId);
      const registered = registeredDirectoryScope(
        scope.scopeId,
        scope.scopeRoot,
        scope.displayName,
      );
      if (this.getHostingState(scopeId) !== "inactive") {
        return {
          ok: false,
          reason: "scope_not_drained",
          message: `Scope ${scopeId} is not an unactivated onboarding registration`,
          scopeId,
        };
      }
      const runtime = this.options.runtimes.get(scopeId);
      let registryRemoved = false;
      try {
        await this.options.runtimeHost.abortUncommitted(runtime, 1, 1_000);
        this.options.registry.remove(scopeId);
        registryRemoved = true;
        if (!this.options.runState.removeUnadmittedScope(scopeId)) {
          throw new Error(`Prepared run-state scope ${scopeId} is missing`);
        }
        this.options.runtimes.remove(scopeId);
      } catch (error) {
        const failures = [error instanceof Error ? error.message : String(error)];
        const persistedScopeId = this.options.runState.getScopeIdByRootPath(scope.scopeRoot);
        if (persistedScopeId === null) {
          try {
            this.options.runState.registerScope({
              id: scope.scopeId,
              rootPath: scope.scopeRoot,
              displayName: scope.displayName,
              createdAt: new Date().toISOString(),
            });
          } catch (restoreError) {
            failures.push(
              `run-state restore: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            );
          }
        } else if (persistedScopeId !== scopeId) {
          failures.push(
            `run-state restore: directory belongs to unexpected scope ${persistedScopeId}`,
          );
        }
        if (registryRemoved) {
          try {
            this.options.registry.add(scope);
          } catch (restoreError) {
            failures.push(
              `scope registry restore: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            );
          }
        }
        if (!this.options.runtimeHost.isHosted(scopeId)) {
          try {
            await this.options.runtimeHost.start(runtime, "prepared");
          } catch (restoreError) {
            failures.push(
              `runtime restore: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            );
          }
        }
        return {
          ok: false,
          reason: "rollback_failed",
          message: failures.join("; "),
          scopeId,
        };
      }
      this.state.delete(scopeId);
      return { ok: true, status: "rolled_back", scope: registered };
    });
  }

  /** Restore the dispatch-closed lifecycle projection for a crash-interrupted onboarding. */
  restorePreparedScope(scopeId: ScopeId): void {
    if (!this.options.registry.get(scopeId) || !this.options.runtimeHost.isHosted(scopeId)) {
      throw new Error(`Cannot restore unhosted onboarding scope ${scopeId}`);
    }
    if (!this.options.runtimeHost.isPrepared(scopeId)) {
      throw new Error(`Cannot restore active onboarding scope ${scopeId}`);
    }
    this.state.set(scopeId, "inactive");
  }

  updateDisplayName(scopeId: ScopeId, displayNameInput: string): Promise<ScopeMutationResult> {
    return this.operations.run(() =>
      updateScopeDisplayName(
        this.options,
        scopeId,
        displayNameInput,
        (transition, affectedScopeId, extra) =>
          this.emit(transition, affectedScopeId, extra),
      ),
    );
  }

  setDefaultScope(scopeId: ScopeId): Promise<ScopeMutationResult> {
    return this.operations.run(() =>
      setDefaultScope(
        this.options,
        scopeId,
        (transition, affectedScopeId, extra) =>
          this.emit(transition, affectedScopeId, extra),
      ),
    );
  }

  drainScope(scopeId: ScopeId): Promise<ScopeDrainResult> {
    return this.operations.run(async () => {
      const scope = this.options.registry.get(scopeId);
      if (!scope) {
        return {
          ok: false,
          reason: "unknown_scope",
          message: `Unknown scope ${scopeId}`,
          scopeId,
          blockers: [],
        };
      }
      if (scopeId === this.options.registry.getDefaultScopeId()) {
        const blocker = defaultScopeBlocker(scopeId);
        return {
          ok: false,
          reason: "default_scope",
          message: blocker.detail,
          scopeId,
          blockers: [blocker],
        };
      }
      if (this.getHostingState(scopeId) === "drained") {
        return {
          ok: true,
          status: "already_drained",
          scope: registeredDirectoryScope(
            scope.scopeId,
            scope.scopeRoot,
            scope.displayName,
          ),
        };
      }

      const runtime = this.options.runtimes.get(scopeId);
      const pausedForDrain = !runtime.workflowRuntime.isDispatchPaused();
      if (pausedForDrain) runtime.workflowRuntime.setDispatchPaused(true);
      this.state.set(scopeId, "draining");
      this.emit("draining", scopeId);
      const blockers = collectScopeDrainBlockers(this.options, runtime);
      if (blockers.length > 0) {
        return this.blockedDrain(scopeId, runtime, pausedForDrain, blockers);
      }

      try {
        await this.options.runtimeHost.stop(runtime, 0);
      } catch (error) {
        return this.blockedDrain(
          scopeId,
          runtime,
          pausedForDrain,
          [runtimeStopBlocker(error as Error)],
        );
      }
      this.state.set(scopeId, "drained");
      this.emit("drained", scopeId);
      return {
        ok: true,
        status: "drained",
        scope: registeredDirectoryScope(
          scope.scopeId,
          scope.scopeRoot,
          scope.displayName,
        ),
      };
    });
  }

  removeScope(scopeId: ScopeId): Promise<ScopeRemovalResult> {
    return this.operations.run(async () => {
      const scope = this.options.registry.get(scopeId);
      if (!scope) return unknownScopeMutation(scopeId);
      if (scopeId === this.options.registry.getDefaultScopeId()) {
        return {
          ok: false,
          reason: "default_scope",
          message: "Select another default scope before removal",
          scopeId,
        };
      }
      if (this.getHostingState(scopeId) !== "drained") {
        return {
          ok: false,
          reason: "scope_not_drained",
          message: `Drain scope ${scopeId} before removal`,
          scopeId,
        };
      }
      const runtime = this.options.runtimes.get(scopeId);
      const blockers = collectScopeDrainBlockers(this.options, runtime);
      if (blockers.length > 0) {
        return {
          ok: false,
          reason: "scope_busy",
          message: `Scope ${scopeId} has resources that require disposition`,
          scopeId,
          blockers,
        };
      }
      let detached: ReturnType<ScopeLifecycleOptions["runtimes"]["remove"]> | null = null;
      try {
        detached = this.options.runtimes.remove(scopeId);
        this.options.registry.remove(scopeId);
      } catch (error) {
        if (detached !== null) {
          try {
            this.options.runtimes.add(detached);
          } catch (rollbackError) {
            return scopeRollbackFailure(scopeId, error as Error, rollbackError as Error);
          }
        }
        return persistenceFailure(scopeId, error as Error);
      }
      this.state.delete(scopeId);
      this.options.bus.emit("scope.lifecycle.changed", {
        transition: "removed",
        affectedScopeId: scopeId,
        directoryRoot: scope.scopeRoot,
        displayName: scope.displayName,
      });
      return {
        ok: true,
        status: "removed",
        scope: registeredDirectoryScope(
          scope.scopeId,
          scope.scopeRoot,
          scope.displayName,
        ),
      };
    });
  }

  getHostingState(scopeId: ScopeId): ScopeHostingState {
    return this.state.get(scopeId)
      ?? (this.options.runtimeHost.isPrepared(scopeId)
        ? "inactive"
        : this.options.runtimeHost.isHosted(scopeId)
          ? "hosted"
          : "inactive");
  }

  listHostingStates(): Array<{ scopeId: ScopeId; state: ScopeHostingState }> {
    return this.options.registry.list().map((scope) => ({
      scopeId: scope.scopeId,
      state: this.getHostingState(scope.scopeId),
    }));
  }

  /** Admit channel work only while the scope's runtime is live and hosted. */
  getChannelRuntime(scopeId: ScopeId): ReturnType<ScopeLifecycleOptions["runtimes"]["get"]> {
    const state = this.getHostingState(scopeId);
    requireScopeChannelAdmission(scopeId, this.options.registry.get(scopeId) !== undefined, state);
    return this.options.runtimes.get(scopeId);
  }

  private blockedDrain(
    scopeId: ScopeId,
    runtime: ReturnType<ScopeLifecycleOptions["runtimes"]["get"]>,
    pausedForDrain: boolean,
    blockers: ScopeDrainBlocker[],
  ): ScopeDrainResult {
    if (pausedForDrain) runtime.workflowRuntime.setDispatchPaused(false);
    this.state.set(scopeId, "hosted");
    this.emit("drain-blocked", scopeId, {
      blockerKinds: blockers.map((blocker) => blocker.kind),
    });
    return {
      ok: false,
      reason: "scope_busy",
      message: `Scope ${scopeId} has resources that require disposition`,
      scopeId,
      blockers,
    };
  }

  private emit(
    transition:
      | "registered"
      | "display-name-updated"
      | "default-changed"
      | "draining"
      | "drain-blocked"
      | "drained",
    scopeId: ScopeId,
    extra: {
      previousDefaultScopeId?: ScopeId;
      blockerKinds?: ScopeDrainBlocker["kind"][];
    } = {},
  ): void {
    const scope = this.options.registry.get(scopeId);
    if (!scope) return;
    this.options.bus.emit("scope.lifecycle.changed", {
      transition,
      affectedScopeId: scopeId,
      directoryRoot: scope.scopeRoot,
      displayName: scope.displayName,
      ...extra,
    });
  }
}
