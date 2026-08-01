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
      const project = this.options.registry.get(scopeId);
      if (!project) {
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
            project.projectId,
            project.projectDir,
            project.displayName,
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
          project.projectId,
          project.projectDir,
          project.displayName,
        ),
      };
    });
  }

  removeScope(scopeId: ScopeId): Promise<ScopeRemovalResult> {
    return this.operations.run(async () => {
      const project = this.options.registry.get(scopeId);
      if (!project) return unknownScopeMutation(scopeId);
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
        directoryRoot: project.projectDir,
        displayName: project.displayName,
      });
      return {
        ok: true,
        status: "removed",
        scope: registeredDirectoryScope(
          project.projectId,
          project.projectDir,
          project.displayName,
        ),
      };
    });
  }

  getHostingState(scopeId: ScopeId): ScopeHostingState {
    return this.state.get(scopeId)
      ?? (this.options.runtimeHost.isHosted(scopeId) ? "hosted" : "inactive");
  }

  listHostingStates(): Array<{ scopeId: ScopeId; state: ScopeHostingState }> {
    return this.options.registry.list().map((project) => ({
      scopeId: project.projectId,
      state: this.getHostingState(project.projectId),
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
    transition: "display-name-updated" | "default-changed" | "draining" | "drain-blocked" | "drained",
    scopeId: ScopeId,
    extra: { previousDefaultScopeId?: ScopeId; blockerKinds?: string[] } = {},
  ): void {
    const project = this.options.registry.get(scopeId);
    if (!project) return;
    this.options.bus.emit("scope.lifecycle.changed", {
      transition,
      affectedScopeId: scopeId,
      directoryRoot: project.projectDir,
      displayName: project.displayName,
      ...extra,
    });
  }
}
