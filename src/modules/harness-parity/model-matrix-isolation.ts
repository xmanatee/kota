import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { resolveAdapterContainerAuth } from "#modules/eval-harness/container-auth.js";
import {
  containerExecutionProfileCanRun,
  createSubprocessExecutor,
  type EvalRunIsolationBackend,
  executionProfileGateReason,
  type ResourceProfile,
  validateIsolationBackend,
  type WorkflowExecutor,
} from "#modules/eval-harness/public-surface.js";
import type { HarnessParityDeps } from "./harness-parity-operations.js";
import { matrixExecutorAuthEnv } from "./model-matrix-execution.js";
import type { MatrixModelSpec } from "./model-matrix-models.js";

export function validateMatrixIsolationBackends(raw: unknown): Record<string, EvalRunIsolationBackend> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("evalIsolationBackends must map provider ids to eval isolation settings.");
  }
  return Object.fromEntries(Object.entries(raw).map(([provider, value]) => {
    const backend = validateIsolationBackend(value);
    if (backend.kind === "container" && backend.networkPolicy?.kind === "provider-egress" &&
      backend.networkPolicy.provider !== provider) {
      throw new Error(`Eval egress provider must match execution provider "${provider}".`);
    }
    return [provider, backend];
  }));
}

export function matrixEvalExecutor(args: {
  deps: HarnessParityDeps;
  spec: MatrixModelSpec;
  harness: AgentHarness;
  backends: Record<string, EvalRunIsolationBackend> | undefined;
}): WorkflowExecutor {
  if (args.deps.evalExecutor) return args.deps.evalExecutor;
  const isolationBackend = args.backends?.[args.spec.executionProvider];
  if (args.backends !== undefined && isolationBackend === undefined) {
    throw new Error(`Missing eval isolation settings for execution provider "${args.spec.executionProvider}".`);
  }
  return createSubprocessExecutor({
    kotaBinaryPath: args.deps.kotaBinaryPath,
    isolationBackend,
    extraEnv: matrixExecutorAuthEnv(args.harness, args.spec, args.deps.scopeRoot, isolationBackend ?? { kind: "host-subprocess" }),
    ...(isolationBackend?.kind === "container" && args.harness.modelRouting?.kind === "native"
      ? { containerAuth: resolveAdapterContainerAuth(args.harness, process.env) } : {}),
    providerEgressTaskBoundary: {
      agentHarness: args.harness.name,
      toolControl: args.harness.toolControl,
    },
  });
}

/** Inspect every execution before scenario inference; the eval owner still scores each repeat. */
export function preflightMatrixEval(args: {
  executor: WorkflowExecutor;
  profile: ResourceProfile;
  outBaseDir: string;
  index: number;
  spec: MatrixModelSpec;
  harness: AgentHarness;
}): string | null {
  let profile: ReturnType<WorkflowExecutor["preflight"]>;
  try {
    profile = args.executor.preflight(args.profile);
  } catch (error) {
    return matrixEvalFailure({ ...args, error });
  }
  // Resource readiness cannot establish a credential or endpoint route.
  // Native login is adapter-owned; local endpoints require provider egress.
  let routingIssue: string | null = null;
  if (profile.backendKind === "container") {
    if (args.harness.modelRouting?.kind === "native" && args.harness.resolveIsolatedContainerAuth === undefined) {
      routingIssue = `Unsupported contained native authentication for harness "${args.harness.name}": implement owner-mediated container login routing before inference; host login locators and provider API keys do not establish this route.`;
    } else if ((args.spec.executionProvider === "ollama" || args.spec.executionProvider === "lmstudio") &&
      (profile.networkPolicy.kind !== "provider-egress" || profile.networkPolicy.provider !== args.spec.executionProvider)) {
      routingIssue = `Provider "${args.spec.executionProvider}" requires a contained local-runtime route with matching provider-egress networking; configure its internal proxy before inference.`;
    } else if ((args.spec.executionProvider === "openrouter" || args.harness.modelRouting?.kind === "native") &&
      (profile.networkPolicy.kind !== "provider-egress" || profile.networkPolicy.provider !== args.spec.executionProvider)) {
      routingIssue = `Provider "${args.spec.executionProvider}" container inference requires matching provider-egress networking; configure its internal proxy before inference.`;
    }
  }
  const verifier = args.executor.predicateContext?.executableVerifierSandbox;
  const verifierIssue = verifier?.kind === "unavailable" ? verifier.issue : null;
  const artifactDir = join(args.outBaseDir, "eval-preflight");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${args.index}.json`);
  writeFileSync(artifactPath, JSON.stringify({
    model: args.spec.model,
    provider: args.spec.executionProvider,
    harness: args.harness.name,
    executionProfile: profile,
    verifierIssue,
    routingIssue,
  }, null, 2));
  if (routingIssue !== null || verifierIssue !== null || profile.status === "rejected" ||
    (profile.backendKind !== "host-subprocess" && !containerExecutionProfileCanRun(profile))) {
    return `${args.spec.label}: ${routingIssue ?? verifierIssue ?? executionProfileGateReason(profile)}; evidence: ${artifactPath}`;
  }
  return null;
}

/** Preserve attribution even when preparation cannot produce an execution profile. */
export function matrixEvalFailure(args: {
  outBaseDir: string; index: number; spec: MatrixModelSpec; harness: AgentHarness; error: unknown;
}): string {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  const artifactDir = join(args.outBaseDir, "eval-preflight");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${args.index}.json`);
  writeFileSync(artifactPath, JSON.stringify({
    model: args.spec.model, provider: args.spec.executionProvider, harness: args.harness.name, error: message,
  }, null, 2));
  return `${args.spec.label}: ${message}; evidence: ${artifactPath}`;
}
