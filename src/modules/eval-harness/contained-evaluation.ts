import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { KotaToolInputSchema } from "#core/agent-harness/message-protocol.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { networkReadEffect } from "#core/tools/effect.js";
import type { ToolRunnerContext } from "#core/tools/tool-registry.js";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { containedEvaluationOperation } from "./contained-evaluation-operation.js";
import { listEvalFixtures } from "./eval-operations.js";
import { validateIsolationBackend } from "./eval-request-validation.js";
import {
  type EvalExecutionContext,
  prepareEvalRunExecution,
} from "./eval-run-execution.js";

export const CONTAINED_EVALUATION_PROFILES_ENV = "KOTA_EVAL_CONTAINED_PROFILES";
const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .max(128);
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("inspect") }).strict(),
  z
    .object({
      operation: z.literal("run"),
      profile: id,
      fixtureIds: z.array(id).min(1),
      repeatCount: z.number().int().positive().default(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("agy-models"),
      profile: id,
      candidates: z.array(z.string().min(1).max(256)).min(1),
      repeatCount: z.number().int().positive().default(1),
    })
    .strict(),
]);
// Module tools expose an object-shaped discovery schema. Preserve the union's
// rejection rules while projecting its fields from the same canonical branches.
const toolInputSchema = {
  ...z.toJSONSchema(requestSchema),
  type: "object",
  properties: {
    ...Object.assign(
      {},
      ...requestSchema.options.map(
        (branch) => z.toJSONSchema(branch).properties,
      ),
    ),
    operation: {
      type: "string",
      enum: requestSchema.options.map((branch) => branch.shape.operation.value),
    },
  },
  required: ["operation"],
} as KotaToolInputSchema;
export type ContainedEvaluationRequest = z.infer<typeof requestSchema>;
export const parseContainedEvaluationRequest = (
  input: unknown,
): ContainedEvaluationRequest => requestSchema.parse(input);

const profileSchema = z
  .object({
    scopeRoots: z.array(z.string().min(1)).min(1),
    preset: z.string().min(1),
    fixtureIds: z.array(id),
    candidates: z.array(z.string().min(1)).default([]),
    maxRepeats: z.number().int().positive(),
    timeoutMs: z.number().int().positive().max(2_147_483_647),
    cpuCores: z.number().positive().finite(),
    memoryMB: z.number().positive().finite(),
    isolationBackend: z.unknown().transform((value) => {
      const backend = validateIsolationBackend(value);
      if (
        backend.kind !== "container" ||
        backend.networkPolicy?.kind !== "provider-egress"
      ) {
        throw new Error(
          "Contained evaluation requires a container and restricted provider-egress policy",
        );
      }
      if (backend.image.startsWith("-"))
        throw new Error("Container image cannot be an option");
      return backend;
    }),
  })
  .strict();

export function containedEvaluationProfiles(
  scopeRoot: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const raw = env[CONTAINED_EVALUATION_PROFILES_ENV];
  if (!raw)
    throw new Error(
      `Set ${CONTAINED_EVALUATION_PROFILES_ENV} in the trusted host environment. Each named profile declares scopeRoots, preset, fixtureIds, candidates, maxRepeats, timeoutMs, cpuCores, memoryMB, and a container isolationBackend with image and restricted provider-egress networkPolicy. See src/modules/eval-harness/contained-evaluation.md for image and restricted egress setup; worker request bodies cannot configure host access.`,
    );
  const profiles = z.record(id, profileSchema).parse(JSON.parse(raw));
  const root = realpathSync(scopeRoot);
  return Object.fromEntries(
    Object.entries(profiles).filter(([, profile]) =>
      profile.scopeRoots.some((allowed) => realpathSync(allowed) === root),
    ),
  );
}

function requireOrigin(context: ToolRunnerContext | undefined) {
  if (
    !context?.workflow ||
    !context.scopeRoot ||
    !context.agentOutputDir ||
    !context.toolUseId ||
    !context.signal
  ) {
    throw new Error(
      "Contained evaluation requires an active workflow invocation and runtime-owned artifacts",
    );
  }
  if (deriveDirectoryScopeId(context.scopeRoot) !== context.workflow.scopeId)
    throw new Error("Contained evaluation scope identity mismatch");
  return context as ToolRunnerContext &
    Required<
      Pick<
        ToolRunnerContext,
        "workflow" | "scopeRoot" | "agentOutputDir" | "toolUseId" | "signal"
      >
    >;
}

export const containedEvaluationTool: ToolDef = {
  nativeInvocation: true,
  tool: {
    name: "contained_evaluation",
    description:
      "Inspect authorized contained-evaluation profiles or run their allowed fixtures/AGY models. Image, network, credentials, scope, resources, and deadline come from the trusted host profile. Results and artifacts belong to this workflow run. Native workflow CLI: kota eval contained '<JSON request>'.",
    input_schema: toolInputSchema,
  },
  effect: networkReadEffect(),
  resolveFilesystemTargets: (_input, context) =>
    context?.agentOutputDir
      ? { kind: "known", paths: [context.agentOutputDir] }
      : { kind: "unknown" },
  runner: async (input, context) => {
    const request = parseContainedEvaluationRequest(input);
    const origin = requireOrigin(context);
    origin.signal.throwIfAborted();
    const profiles = containedEvaluationProfiles(origin.scopeRoot);
    if (request.operation === "inspect") {
      return {
        content: JSON.stringify(
          {
            profiles,
            fixtures: listEvalFixtures(),
            setupGuide: "src/modules/eval-harness/contained-evaluation.md",
          },
          null,
          2,
        ),
      };
    }
    const profile = profiles[request.profile];
    if (!profile)
      throw new Error(
        "Evaluation profile is not authorized for this scope; inspect available profiles",
      );
    if (request.repeatCount > profile.maxRepeats)
      throw new Error("Requested repeat count exceeds the host profile");
    if (
      request.operation === "run" &&
      request.fixtureIds.some(
        (fixture) => !profile.fixtureIds.includes(fixture),
      )
    )
      throw new Error("Scenario is not authorized by the host profile");
    if (
      request.operation === "agy-models" &&
      (profile.preset !== "antigravity-cli" ||
        request.candidates.some(
          (candidate) => !profile.candidates.includes(candidate),
        ))
    )
      throw new Error("Candidate is not authorized by the host profile");
    if (!origin.onProcessSpawn)
      throw new Error(
        "Contained evaluation requires runtime process supervision",
      );
    const artifactDir = join(
      origin.agentOutputDir,
      origin.toolUseId.replace(/[^a-zA-Z0-9_-]/g, "_"),
    );
    mkdirSync(artifactDir); // Never overwrite or replay a completed invocation.
    const execution: EvalExecutionContext = {
      artifactDir,
      signal: AbortSignal.any([
        origin.signal,
        AbortSignal.timeout(profile.timeoutMs),
      ]),
      env: { ...process.env, [PRESET_ENV_VAR]: profile.preset },
      onProcessSpawn: origin.onProcessSpawn,
      onExecutionFailure: origin.onExecutionFailure,
    };
    writeFileSync(
      join(artifactDir, "request.json"),
      JSON.stringify(
        {
          origin: origin.workflow,
          request,
          profile,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    const options = {
      repeatCount: request.repeatCount,
      isolationBackend: profile.isolationBackend,
      cpuAllocationCores: profile.cpuCores,
      cpuKillThresholdCores: profile.cpuCores,
      memoryAllocationMB: profile.memoryMB,
      memoryKillThresholdMB: profile.memoryMB,
      keepWorkingDirs: false,
    };
    try {
      const prepared = prepareEvalRunExecution(
        origin.scopeRoot,
        options,
        execution.env,
      );
      const result = await runWorkflowBlockingOperation(
        containedEvaluationOperation,
        {
          workspaceRoot: origin.scopeRoot,
          request,
          options,
          artifactDir,
          env: execution.env,
          prepared,
        },
        {
          signal: execution.signal,
          onProcessSpawn: execution.onProcessSpawn,
          onExecutionFailure: execution.onExecutionFailure,
        },
      );
      if (!result.ok) origin.onExecutionFailure?.(new Error(result.message));
      execution.signal.throwIfAborted();
      writeFileSync(
        join(artifactDir, "result.json"),
        JSON.stringify(result, null, 2),
      );
      return {
        content: JSON.stringify({
          origin: origin.workflow,
          artifactDir,
          result,
        }),
        is_error: !result.ok,
      };
    } catch (error) {
      origin.onExecutionFailure?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      const message = error instanceof Error ? error.message : String(error);
      writeFileSync(
        join(artifactDir, "failure.json"),
        JSON.stringify(
          { message, cancelled: execution.signal.aborted },
          null,
          2,
        ),
      );
      return {
        content: JSON.stringify({
          origin: origin.workflow,
          artifactDir,
          error: message,
        }),
        is_error: true,
      };
    }
  },
};
