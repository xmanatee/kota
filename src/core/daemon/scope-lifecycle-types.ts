import type { EventBus } from "#core/events/event-bus.js";
import type { ProjectRuntimeRegistry } from "./project-runtime.js";
import type {
  ScopeDrainBlocker,
  ScopeExternalDrainBlocker,
} from "./scope-drain-inspection.js";
import type { ScopeId, ScopeRegistry } from "./scope-registry.js";
import type { ScopeRuntimeHost } from "./scope-runtime-host.js";

export type ScopeHostingState = "inactive" | "hosted" | "draining" | "drained";

export type DirectoryScopeRegistrationInput = {
  directoryRoot: string;
  displayName?: string;
};

export type RegisteredDirectoryScope = {
  readonly scopeId: ScopeId;
  readonly directoryRoot: string;
  readonly displayName: string;
};

export type ScopeLifecycleFailureReason =
  | "invalid_directory"
  | "directory_not_found"
  | "directory_inaccessible"
  | "not_directory"
  | "duplicate_scope"
  | "unknown_scope"
  | "invalid_display_name"
  | "daemon_not_running"
  | "persistence_failed"
  | "runtime_start_failed"
  | "runtime_update_failed"
  | "rollback_failed"
  | "scope_busy"
  | "scope_not_hosted"
  | "scope_not_drained"
  | "default_scope";

export type ScopeRegistrationResult =
  | { ok: true; status: "registered"; scope: RegisteredDirectoryScope }
  | {
      ok: false;
      reason: ScopeLifecycleFailureReason;
      message: string;
      scopeId?: ScopeId;
      existing?: RegisteredDirectoryScope;
    };

export type ScopeMutationResult =
  | {
      ok: true;
      status: "updated" | "unchanged" | "default_changed" | "removed";
      scope: RegisteredDirectoryScope;
    }
  | ScopeMutationFailure;

export type ScopeMutationFailure<
  TReason extends ScopeLifecycleFailureReason = ScopeLifecycleFailureReason,
> = {
  ok: false;
  reason: TReason;
  message: string;
  scopeId: ScopeId;
};

export type ScopeDrainResult =
  | {
      ok: true;
      status: "drained" | "already_drained";
      scope: RegisteredDirectoryScope;
    }
  | {
      ok: false;
      reason: "unknown_scope" | "default_scope" | "scope_busy";
      message: string;
      scopeId: ScopeId;
      blockers: ScopeDrainBlocker[];
    };

export type ScopeRemovalResult =
  | { ok: true; status: "removed"; scope: RegisteredDirectoryScope }
  | ScopeMutationFailure<Exclude<ScopeLifecycleFailureReason, "scope_busy">>
  | {
      ok: false;
      reason: "scope_busy";
      message: string;
      scopeId: ScopeId;
      blockers: ScopeDrainBlocker[];
    };

export type ScopeLifecycleOptions = {
  registry: ScopeRegistry;
  runtimes: ProjectRuntimeRegistry;
  runtimeHost: ScopeRuntimeHost;
  bus: EventBus;
  listSessionIds: (scopeId: ScopeId) => readonly string[];
  inspectExternalBlockers: (
    scope: RegisteredDirectoryScope,
  ) => readonly ScopeExternalDrainBlocker[] | readonly ScopeDrainBlocker[];
};

export function registeredDirectoryScope(
  scopeId: ScopeId,
  directoryRoot: string,
  displayName: string,
): RegisteredDirectoryScope {
  return {
    scopeId,
    directoryRoot,
    displayName,
  };
}

export function unknownScopeMutation(
  scopeId: ScopeId,
): ScopeMutationFailure<"unknown_scope"> {
  return {
    ok: false,
    reason: "unknown_scope",
    message: `Unknown scope ${scopeId}`,
    scopeId,
  };
}

export function persistenceFailure(
  scopeId: ScopeId,
  error: object | null,
): ScopeMutationFailure<"persistence_failed"> {
  return {
    ok: false,
    reason: "persistence_failed",
    message: errorMessage(error),
    scopeId,
  };
}

export function errorMessage(error: object | null): string {
  return error instanceof Error ? error.message : String(error);
}
