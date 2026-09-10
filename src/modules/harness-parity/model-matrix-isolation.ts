import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentHarness } from "#core/agent-harness/index.js";
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
  const profile = args.executor.preflight(args.profile);
  // Resource readiness cannot establish a credential or endpoint route. The
  // shared container owner currently supplies neither native login mediation
  // nor connectivity to the host's local model servers.
  let routingIssue: string | null = null;
  if (profile.backendKind === "container") {
    if (args.harness.modelRouting?.kind === "native") {
      routingIssue = `Unsupported contained native authentication for harness "${args.harness.name}": implement owner-mediated container login routing before inference; host login locators and provider API keys do not establish this route.`;
    } else if (args.spec.executionProvider === "ollama" || args.spec.executionProvider === "lmstudio") {
      routingIssue = `Unsupported contained local endpoint for provider "${args.spec.executionProvider}": implement a contained local-runtime route through the eval isolation and model-client owners before inference; container localhost cannot reach the host model server, and installing a host model does not resolve this gap.`;
    } else if (args.spec.executionProvider === "openrouter" &&
      (profile.networkPolicy.kind !== "provider-egress" || profile.networkPolicy.provider !== "openrouter")) {
      routingIssue = "OpenRouter container inference requires matching provider-egress networking; omitted or offline network policies cannot reach the provider. Configure enforced OpenRouter egress before inference.";
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
