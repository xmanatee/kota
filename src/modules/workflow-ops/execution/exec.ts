import type { Command } from "commander";
import type { AgentEffort } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { createProjectRuntime } from "#core/daemon/project-runtime.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import type {
  WorkflowAgentStep,
  WorkflowCodeStep,
  WorkflowStep,
} from "#core/workflow/step-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";

export type AgentExecutionOverride = {
  harness: string;
  model: string;
  effort?: AgentEffort;
};

const AGENT_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly AgentEffort[];

function trimOption(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveAgentExecutionOverride(opts: {
  agentHarness?: string;
  agentModel?: string;
  agentEffort?: string;
}): AgentExecutionOverride | undefined {
  const harness = trimOption(opts.agentHarness);
  const model = trimOption(opts.agentModel);
  const effort = trimOption(opts.agentEffort);
  if ((harness === undefined) !== (model === undefined)) {
    printWorkflowError(
      "--agent-harness and --agent-model must be provided together.",
    );
    process.exit(1);
  }
  if (effort !== undefined && (harness === undefined || model === undefined)) {
    printWorkflowError(
      "--agent-effort requires --agent-harness and --agent-model.",
    );
    process.exit(1);
  }
  if (
    effort !== undefined &&
    !AGENT_EFFORTS.includes(effort as AgentEffort)
  ) {
    printWorkflowError(
      `--agent-effort must be one of: ${AGENT_EFFORTS.join(", ")}.`,
    );
    process.exit(1);
  }
  return harness !== undefined && model !== undefined
    ? {
        harness,
        model,
        ...(effort !== undefined && { effort: effort as AgentEffort }),
      }
    : undefined;
}

function overrideAgentStep(
  step: WorkflowAgentStep,
  override: AgentExecutionOverride,
): WorkflowAgentStep {
  const { tier: _tier, ...withoutTier } = step;
  return {
    ...withoutTier,
    harness: override.harness,
    model: override.model,
    ...(override.effort !== undefined && { effort: override.effort }),
  };
}

function overrideAgentOrCodeStep(
  step: WorkflowAgentStep | WorkflowCodeStep,
  override: AgentExecutionOverride,
): WorkflowAgentStep | WorkflowCodeStep {
  return step.type === "agent" ? overrideAgentStep(step, override) : step;
}

function overrideWorkflowStep(
  step: WorkflowStep,
  override: AgentExecutionOverride,
): WorkflowStep {
  if (step.type === "agent") {
    return overrideAgentStep(step, override);
  }
  if (step.type === "parallel" || step.type === "foreach") {
    return {
      ...step,
      steps: step.steps.map((child) =>
        overrideAgentOrCodeStep(child, override),
      ),
    };
  }
  if (step.type === "branch") {
    return {
      ...step,
      ifTrue: step.ifTrue.map((child) => overrideWorkflowStep(child, override)),
      ifFalse: step.ifFalse.map((child) =>
        overrideWorkflowStep(child, override),
      ),
    };
  }
  return step;
}

export function overrideWorkflowAgentExecution(
  definition: WorkflowDefinition,
  override: AgentExecutionOverride,
): WorkflowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) =>
      overrideWorkflowStep(step, override),
    ),
  };
}

/**
 * `kota workflow exec <name>` — synchronously execute one workflow run to
 * terminal status without going through the daemon control plane or the
 * pending-runs queue. The process exits 0 when the run finishes successfully
 * (including `completed-with-warnings`) and non-zero otherwise.
 *
 * This exists so the eval-harness subprocess executor has a single CLI entry
 * point that actually drives a workflow to completion inside the fixture's
 * isolated working directory. The `trigger` command only enqueues a pending
 * run and is inert without a daemon.
 */
export function registerExecCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("exec <name>")
    .description(
      "Synchronously execute one workflow run to terminal status without a daemon.",
    )
    .option("--event <event>", "Trigger event name", "manual")
    .option("--payload <json>", "JSON object merged into the trigger payload")
    .option("--agent-harness <name>", "Override every agent step harness")
    .option("--agent-model <model>", "Override every agent step model")
    .option("--agent-effort <effort>", "Override every agent step effort")
    .action(async (
      name: string,
      opts: {
        event: string;
        payload?: string;
        agentHarness?: string;
        agentModel?: string;
        agentEffort?: string;
      },
    ) => {
      const agentExecutionOverride = resolveAgentExecutionOverride(opts);
      let extraPayload: Record<string, unknown> | undefined;
      if (opts.payload !== undefined) {
        try {
          const parsed: unknown = JSON.parse(opts.payload);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("payload must be a JSON object");
          }
          extraPayload = parsed as Record<string, unknown>;
        } catch (err) {
          printWorkflowError(`Invalid --payload JSON: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      const runtimeConfig = loadConfig(ctx.cwd);
      const bus = new EventBus();
      const runtimeLoader = await loadRuntimeModules({
        config: runtimeConfig,
        cwd: ctx.cwd,
        eventBus: bus,
      });
      try {
        const runtime = resolveAgentRuntime(runtimeConfig);
        const validationOptions = {
          defaultAgentHarness: runtime.harness,
          preset: runtime.preset,
          modelTiers: runtime.tiers,
          agentModels: runtimeConfig.agentModels,
          resolveAgentDef: (agentName: string) => runtimeLoader.getAgentDef(agentName),
        };
        const definitions = validateWorkflowDefinitions(
          runtimeLoader.getContributedWorkflows(),
          ctx.cwd,
          validationOptions,
        );
        const definition = definitions.find((d) => d.name === name);
        if (!definition) {
          const names = definitions.map((d) => d.name).join(", ");
          printWorkflowError(`Unknown workflow "${name}". Available: ${names}`);
          process.exit(1);
        }
        if (!definition.enabled) {
          printWorkflowError(`Workflow "${name}" is disabled.`);
          process.exit(1);
        }
        const executionDefinition = agentExecutionOverride !== undefined
          ? validateWorkflowDefinitions(
              [overrideWorkflowAgentExecution(definition, agentExecutionOverride)],
              ctx.cwd,
              validationOptions,
            )[0]
          : definition;
        if (executionDefinition === undefined) {
          throw new Error(`Workflow "${name}" disappeared during execution validation.`);
        }

        const scopeId = deriveDirectoryScopeId(ctx.cwd);
        const projectRuntime = createProjectRuntime({
          project: {
            projectId: scopeId,
            projectDir: ctx.cwd,
            displayName: scopeId,
          },
          bus,
          config: runtimeConfig,
          workflows: definitions,
          onLog: (message) => printWorkflowError(message),
          installSingletons: false,
        });
        const registry = getProviderRegistry();
        if (registry === null) {
          throw new Error("Workflow execution runtime provider registry is unavailable");
        }
        registry.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "daemon", {
          resolve: (selectedId) => selectedId === scopeId
            ? { ok: true, runtime: projectRuntime }
            : { ok: false, projectId: selectedId },
        });
        const trigger: WorkflowRunTrigger = {
          event: opts.event,
          schemaRef: null, payload: {
            ...(extraPayload ?? {}),
            triggeredAt: new Date().toISOString(),
          },
        };

        const { promise } = executeWorkflowRun(executionDefinition, trigger, {
          projectDir: ctx.cwd,
          bus,
          pbus: projectRuntime.pbus,
          store: projectRuntime.runStore,
          config: runtimeConfig,
          log: (msg) => printWorkflowError(msg),
          resolveAgentDef: (agentName) => runtimeLoader.getAgentDef(agentName),
          resolveSkillsPrompt: (names, agentName) =>
            runtimeLoader.getSkillsPromptFor(names, agentName),
        });

        const result = await promise;
        printWorkflowText(result.metadata.id);
        if (
          result.metadata.status !== "success" &&
          result.metadata.status !== "completed-with-warnings"
        ) {
          process.exitCode = 1;
        }
      } finally {
        await runtimeLoader.unloadAll();
      }
    });
}
