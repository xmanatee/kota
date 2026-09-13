import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ContainerAuthUnavailableError } from "#core/agent-harness/harness-definition.js";
import type { AgentHarness, KotaToolInputSchema } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { resolveKotaBinary, resolveKotaRuntimeAsset } from "#core/util/kota-install-paths.js";
import { defineWorkflowBlockingOperation, runWorkflowBlockingOperation, type WorkflowBlockingOperationContext } from "#core/workflow/blocking-operation.js";
import { containedEvaluationProfiles, requireContainedEvaluationOrigin } from "#modules/eval-harness/contained-evaluation.js";
import { containerAuthIssue } from "#modules/eval-harness/container-auth.js";
import { createSubprocessExecutor } from "#modules/eval-harness/subprocess-executor.js";
import type { SubprocessExecutorOptions } from "#modules/eval-harness/subprocess-executor-types.js";
import type { HarnessParityMatrixOptions } from "./client.js";
import { containedScenarioExecution } from "./contained-scenario.js";
import type { HarnessParityDeps } from "./harness-parity-operations.js";
import { resolveMatrixExecutions, runHarnessParityModelMatrix } from "./model-matrix.js";
import { matrixExecutorAuthEnv } from "./model-matrix-execution.js";
import { validateMatrixIsolationBackends } from "./model-matrix-isolation.js";
import { type MatrixModelSpec, type MatrixOpenRouterPreflight, resolveOpenRouterPreflight } from "./model-matrix-models.js";
import { loadScenario } from "./scenario.js";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).max(128);
export const containedMatrixRequest = z.object({ operation: z.enum(["inspect", "run"]), profile: id,
  repeatCount: z.number().int().positive().default(1) }).strict();
const model = z.object({ model: z.string().min(1), label: id,
  provider: z.enum(["openai", "openrouter", "local", "anthropic"]) }).strict();
export const containedMatrixSelection = z.object({
  baselines: z.array(model).min(1), candidates: z.array(model).min(1),
  harnesses: z.array(id).min(1), harnessesByLabel: z.record(id, z.array(id).min(1)), scenarios: z.array(id), evalFixtures: z.array(id),
  evalIsolationBackends: z.unknown().transform(validateMatrixIsolationBackends),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  maxTurns: z.number().int().positive().optional(),
}).strict().superRefine((selection, ctx) => {
  if (!selection.scenarios.length && !selection.evalFixtures.length) ctx.addIssue({ code: "custom", message: "Matrix requires a nonempty cohort" });
  const labels = [...selection.baselines, ...selection.candidates].map((entry) => entry.label);
  if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", message: "Matrix labels must be unique" });
  for (const label of labels) {
    const allowed = selection.harnessesByLabel[label];
    if (!allowed || allowed.some((name) => !selection.harnesses.includes(name))) ctx.addIssue({ code: "custom", message: `Label ${label} requires an explicit subset of the harness pool` });
  }
  if (Object.keys(selection.harnessesByLabel).some((label) => !labels.includes(label))) ctx.addIssue({ code: "custom", message: "Harness selection names an unknown model label" });
  for (const backend of Object.values(selection.evalIsolationBackends)) {
    if (backend.kind !== "container" || backend.networkPolicy?.kind !== "provider-egress")
      ctx.addIssue({ code: "custom", message: "Contained matrix requires provider-egress containers for every route" });
  }
});
type HarnessFacts = Pick<AgentHarness, "name" | "description" | "supportsMultiTurn" | "supportedHookKinds" | "askOwnerToolName" | "emitsAgentMessageStream" | "toolControl" | "modelRouting" | "nativeAbortQuarantine" | "unsupportedRunOptions">;
export type PreparedContainedMatrix = {
  deps: Omit<HarnessParityDeps, "matrixExecution" | "evalExecutor">;
  options: HarnessParityMatrixOptions;
  budgetMs: number;
  env: NodeJS.ProcessEnv;
  openRouterPreflight: MatrixOpenRouterPreflight;
  executions: ({ spec: MatrixModelSpec; harness: HarnessFacts } & (
    | { status: "ready"; executorOptions: SubprocessExecutorOptions }
    | { status: "unavailable"; reason: string }
  ))[];
};
export function prepareContainedMatrix(scopeRoot: string, artifactDir: string,
  profile: ReturnType<typeof containedEvaluationProfiles>[string], repeatCount: number): PreparedContainedMatrix {
  const selection = containedMatrixSelection.parse(profile.matrix);
  if (repeatCount > profile.maxRepeats) throw new Error("Requested repeat count exceeds the host profile");
  const config = loadConfig(scopeRoot);
  if (!profile.preset) throw new Error("Contained matrix requires an explicit host preset");
  const env = { [PRESET_ENV_VAR]: profile.preset };
  const options: HarnessParityMatrixOptions = { ...selection, repeats: repeatCount, outDir: artifactDir,
    cpuAllocationCores: profile.cpuCores, cpuKillThresholdCores: profile.cpuCores,
    memoryAllocationMB: profile.memoryMB, memoryKillThresholdMB: profile.memoryMB,
    hostClass: "contained-model-matrix" };
  const resolved = resolveMatrixExecutions(config, options);
  if (!Array.isArray(resolved)) throw new Error(resolved.ok ? "Invalid matrix execution plan" : resolved.message);
  const kotaBinaryPath = resolveKotaBinary();
  const scenariosRoot = resolveKotaRuntimeAsset("src/modules/harness-parity/scenarios");
  for (const scenarioId of selection.scenarios) {
    for (const stage of loadScenario(scenariosRoot, scenarioId).spec.stages) {
      if (stage.verification.trustedFiles === undefined) throw new Error(`Contained scenario ${scenarioId} must declare verification.trustedFiles`);
    }
  }
  const selected = resolved.filter(({ spec, harness }) => selection.harnessesByLabel[spec.label]!.includes(harness.name));
  for (const [label, names] of Object.entries(selection.harnessesByLabel)) {
    if (names.some((name) => !selected.some((entry) => entry.spec.label === label && entry.harness.name === name))) throw new Error(`Requested matrix route for ${label} is incompatible`);
  }
  const executions: PreparedContainedMatrix["executions"] = selected.map(({ spec, harness }) => {
    const backend = selection.evalIsolationBackends[spec.executionProvider];
    if (backend?.kind !== "container" || backend.networkPolicy?.kind !== "provider-egress" || backend.networkPolicy.provider !== spec.executionProvider)
      throw new Error(`Missing contained provider route for ${spec.executionProvider}`);
    const facts: HarnessFacts = { name: harness.name, description: harness.description,
      supportsMultiTurn: harness.supportsMultiTurn, supportedHookKinds: harness.supportedHookKinds,
      askOwnerToolName: harness.askOwnerToolName, emitsAgentMessageStream: harness.emitsAgentMessageStream,
      toolControl: harness.toolControl, modelRouting: harness.modelRouting,
      nativeAbortQuarantine: harness.nativeAbortQuarantine, unsupportedRunOptions: harness.unsupportedRunOptions };
    let containerAuth: SubprocessExecutorOptions["containerAuth"];
    let unavailableReason: string | null = null;
    if (harness.modelRouting?.kind === "native" && !harness.resolveIsolatedContainerAuth) {
      unavailableReason = `Harness ${harness.name} has no contained native authentication contract`;
    } else {
      try {
        containerAuth = harness.resolveIsolatedContainerAuth?.(process.env);
      } catch (error) {
        if (!(error instanceof ContainerAuthUnavailableError)) throw error;
        unavailableReason = error.message;
      }
      if (containerAuth) unavailableReason = containerAuthIssue(containerAuth);
    }
    if (unavailableReason !== null) return { spec, harness: facts, status: "unavailable", reason: unavailableReason };
    return { spec, harness: facts, status: "ready", executorOptions: {
      kotaBinaryPath, isolationBackend: backend,
      extraEnv: { ...matrixExecutorAuthEnv(harness, spec, scopeRoot, backend), ...env },
      containerAuth,
      providerEgressTaskBoundary: { agentHarness: harness.name, toolControl: harness.toolControl },
    } };
  });
  return { deps: { scopeRoot, scenariosRoot, evalFixturesRoot: resolveKotaRuntimeAsset("src/modules/eval-harness/fixtures"),
    defaultOutBaseDir: artifactDir, kotaBinaryPath, config: { defaultPreset: profile.preset ?? config.defaultPreset, modelOutputTokenLimits: config.modelOutputTokenLimits } },
    options, env, budgetMs: profile.timeoutMs, openRouterPreflight: resolveOpenRouterPreflight(scopeRoot), executions };
}

export async function runContainedMatrix(input: PreparedContainedMatrix, context: WorkflowBlockingOperationContext) {
  context.signal.throwIfAborted();
  const executions = input.executions.map((entry) => {
    const harness: AgentHarness = { ...entry.harness,
      ...(entry.status === "ready" && entry.executorOptions.containerAuth ? { resolveIsolatedContainerAuth: () => entry.executorOptions.containerAuth! } : {}),
      async run() { throw new Error("Contained matrix cannot launch an agent on the host"); } };
    if (entry.status === "unavailable") return { spec: entry.spec, harness, unavailableReason: entry.reason };
    const options = { ...entry.executorOptions, signal: context.signal, onProcessSpawn: context.onProcessSpawn, onExecutionFailure: context.onExecutionFailure };
    return { spec: entry.spec, harness, evalExecutor: createSubprocessExecutor(options), options };
  });
  return runHarnessParityModelMatrix({ ...input.deps, matrixExecution: {
    executions, openRouterPreflight: input.openRouterPreflight, signal: context.signal, env: input.env,
    scenarioExecution: (spec, harness, executor, profile) => {
      const entry = executions.find((entry) => entry.spec === spec && entry.harness === harness);
      if (!entry?.options) throw new Error("Contained matrix execution identity missing");
      return containedScenarioExecution(entry.options, harness, executor.preflight(profile), input.budgetMs);
    },
  } }, input.options);
}
const operation = defineWorkflowBlockingOperation<PreparedContainedMatrix, Awaited<ReturnType<typeof runContainedMatrix>>>(import.meta.url, "runContainedMatrix");

export const containedMatrixTool: ToolDef = {
  nativeInvocation: true,
  tool: { name: "contained_model_matrix", description: "Inspect or execute the exact model matrix granted by a trusted contained-evaluation profile. Requests cannot change models, scenarios, images, credentials, resources or output paths.",
    input_schema: z.toJSONSchema(containedMatrixRequest) as KotaToolInputSchema },
  effect: networkReadEffect(),
  resolveFilesystemTargets: (_input, context) => context?.agentOutputDir ? { kind: "known", paths: [context.agentOutputDir] } : { kind: "unknown" },
  runner: async (raw, context) => {
    const request = containedMatrixRequest.parse(raw);
    const origin = requireContainedEvaluationOrigin(context);
    origin.signal.throwIfAborted();
    const profiles = containedEvaluationProfiles(origin.scopeRoot);
    const profile = Object.hasOwn(profiles, request.profile) ? profiles[request.profile] : undefined;
    if (!profile) throw new Error("Matrix profile is not authorized for this scope");
    const selection = containedMatrixSelection.parse(profile.matrix);
    if (request.repeatCount > profile.maxRepeats) throw new Error("Requested repeat count exceeds the host profile");
    if (request.operation === "inspect") return { content: JSON.stringify({ profile: request.profile, selection, maxRepeats: profile.maxRepeats }) };
    if (!origin.onProcessSpawn) throw new Error("Contained matrix requires runtime process supervision");
    const artifactDir = join(origin.agentOutputDir, origin.toolUseId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    mkdirSync(artifactDir);
    writeFileSync(join(artifactDir, "request.json"), JSON.stringify({ origin: origin.workflow, request, profile, startedAt: new Date().toISOString() }, null, 2));
    try {
      const result = await runWorkflowBlockingOperation(operation,
        prepareContainedMatrix(origin.scopeRoot, artifactDir, profile, request.repeatCount), {
          signal: AbortSignal.any([origin.signal, AbortSignal.timeout(profile.timeoutMs)]),
          onProcessSpawn: origin.onProcessSpawn, onExecutionFailure: origin.onExecutionFailure,
        });
      writeFileSync(join(artifactDir, "result.json"), JSON.stringify(result, null, 2));
      return { content: JSON.stringify({ origin: origin.workflow, artifactDir, result }), is_error: !result.ok };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      origin.onExecutionFailure?.(error instanceof Error ? error : new Error(message));
      writeFileSync(join(artifactDir, "failure.json"), JSON.stringify({ message, cancelled: origin.signal.aborted }, null, 2));
      return { content: JSON.stringify({ origin: origin.workflow, artifactDir, error: message }), is_error: true };
    }
  },
};
