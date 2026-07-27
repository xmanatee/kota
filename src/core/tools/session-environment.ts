import type { ToolRunnerContext } from "./index.js";

type SessionEnvironmentContext = Pick<
  ToolRunnerContext,
  "sessionId" | "scopeId" | "projectId" | "workflow"
>;

type SessionEnvironmentIdentity = {
  scopeId: string;
  sessionId: string;
};

type SessionEnvironment = {
  activeReferences: number;
  version: number;
  values: Map<string, string>;
  resources: Set<() => void>;
};

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const environmentsByScope = new Map<string, Map<string, SessionEnvironment>>();
let nextEnvironmentVersion = 1;

function oneIdentityValue(
  label: string,
  values: Array<string | undefined>,
): string | undefined {
  const present = values.filter((value): value is string => value !== undefined);
  if (present.some((value) => value.length === 0)) {
    throw new Error(`Session environment ${label} must be non-empty`);
  }
  const unique = new Set(present);
  if (unique.size > 1) {
    throw new Error(`Session environment ${label} values conflict`);
  }
  return present[0];
}

function resolveIdentity(
  context: SessionEnvironmentContext | undefined,
): SessionEnvironmentIdentity | null {
  if (context === undefined) return null;
  // A workflow span is tracing metadata, not a runtime session identity.
  // Older/direct tool callers may omit sessionId and still fall back to it.
  const sessionId = oneIdentityValue("session id", [context.sessionId]) ??
    context.workflow?.spanId;
  const scopeId = oneIdentityValue("scope id", [
    context.scopeId,
    context.projectId,
    context.workflow?.scopeId,
    context.workflow?.projectId,
  ]);
  if (sessionId === undefined || scopeId === undefined) return null;
  return { sessionId, scopeId };
}

function requireIdentity(
  context: SessionEnvironmentContext,
): SessionEnvironmentIdentity {
  const identity = resolveIdentity(context);
  if (identity === null) {
    throw new Error(
      "Credential injection requires an active session and project scope",
    );
  }
  return identity;
}

function environmentForIdentity(
  identity: SessionEnvironmentIdentity,
): SessionEnvironment | undefined {
  return environmentsByScope.get(identity.scopeId)?.get(identity.sessionId);
}

/** Mark a session as live before it can receive credential environment values. */
export function registerSessionEnvironment(
  context: SessionEnvironmentContext,
): void {
  const identity = requireIdentity(context);
  let sessions = environmentsByScope.get(identity.scopeId);
  if (sessions === undefined) {
    sessions = new Map();
    environmentsByScope.set(identity.scopeId, sessions);
  }
  const current = sessions.get(identity.sessionId);
  if (current !== undefined) {
    current.activeReferences++;
    return;
  }
  sessions.set(identity.sessionId, {
    activeReferences: 1,
    version: nextEnvironmentVersion++,
    values: new Map(),
    resources: new Set(),
  });
}

/**
 * Erase a session's credential overlay when its final live owner tears down.
 * Repeated registrations are reference-counted for nested harness boundaries.
 */
export function unregisterSessionEnvironment(
  context: SessionEnvironmentContext,
): void {
  const identity = resolveIdentity(context);
  if (identity === null) return;
  const sessions = environmentsByScope.get(identity.scopeId);
  const current = sessions?.get(identity.sessionId);
  if (sessions === undefined || current === undefined) return;
  current.activeReferences--;
  if (current.activeReferences > 0) return;
  const resources = [...current.resources];
  current.resources.clear();
  current.values.clear();
  sessions.delete(identity.sessionId);
  if (sessions.size === 0) environmentsByScope.delete(identity.scopeId);
  const errors: Error[] = [];
  for (const cleanup of resources) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Session environment resource cleanup failed",
    );
  }
}

/** Store a credential only for the active session and project that authorized it. */
export function injectSessionEnvironmentVariable(
  context: SessionEnvironmentContext,
  name: string,
  value: string,
): void {
  if (!ENVIRONMENT_VARIABLE_NAME.test(name)) {
    throw new Error(`Secret name "${name}" is not a valid environment variable`);
  }
  const identity = requireIdentity(context);
  const environment = environmentForIdentity(identity);
  if (environment === undefined || environment.activeReferences < 1) {
    throw new Error("Credential injection requires a live session");
  }
  environment.values.set(name, value);
  environment.version = nextEnvironmentVersion++;
}

/** Return a copy of the credential overlay visible to this exact session and project. */
export function sessionEnvironmentForExecution(
  context: SessionEnvironmentContext | undefined,
): Readonly<Record<string, string>> {
  const identity = resolveIdentity(context);
  if (identity === null) return {};
  const environment = environmentForIdentity(identity);
  if (environment === undefined || environment.activeReferences < 1) return {};
  return Object.fromEntries(environment.values);
}

/**
 * A monotonic token for long-lived executors. A changed token means the
 * process must restart before it can safely execute with the current overlay.
 */
export function sessionEnvironmentVersionForExecution(
  context: SessionEnvironmentContext | undefined,
): number | null {
  const identity = resolveIdentity(context);
  if (identity === null) return null;
  const environment = environmentForIdentity(identity);
  if (environment === undefined || environment.activeReferences < 1) return null;
  return environment.version;
}

/** Bind a long-lived execution resource to the session that created it. */
export function registerSessionEnvironmentResource(
  context: SessionEnvironmentContext | undefined,
  cleanup: () => void,
): () => void {
  const identity = resolveIdentity(context);
  if (identity === null) return () => {};
  const environment = environmentForIdentity(identity);
  if (environment === undefined || environment.activeReferences < 1) {
    return () => {};
  }
  environment.resources.add(cleanup);
  return () => {
    environment.resources.delete(cleanup);
  };
}
