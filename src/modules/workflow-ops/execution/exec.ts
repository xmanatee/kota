import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { Command } from "commander";
import type { AgentEffort } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { formatRunId } from "#core/workflow/run-io.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import type { WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import type { WorkflowClient } from "../client.js";

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
  step: WorkflowAgentStepInput,
  override: AgentExecutionOverride,
): WorkflowAgentStepInput {
  const { tier: _tier, ...withoutTier } = step;
  return {
    ...withoutTier,
    harness: override.harness,
    model: override.model,
    ...(override.effort !== undefined && { effort: override.effort }),
  };
}

function overrideAgentOrCodeStep(
  step: WorkflowAgentStepInput | WorkflowCodeStepInput,
  override: AgentExecutionOverride,
): WorkflowAgentStepInput | WorkflowCodeStepInput {
  return step.type === "agent" ? overrideAgentStep(step, override) : step;
}

function overrideWorkflowStep(
  step: WorkflowStepInput,
  override: AgentExecutionOverride,
): WorkflowStepInput {
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
      ...(step.ifFalse === undefined
        ? {}
        : {
            ifFalse: step.ifFalse.map((child) =>
              overrideWorkflowStep(child, override),
            ),
          }),
    };
  }
  return step;
}

export function overrideWorkflowAgentExecution(
  definition: RegisteredWorkflowDefinitionInput,
  override: AgentExecutionOverride,
): RegisteredWorkflowDefinitionInput {
  return {
    ...definition,
    steps: definition.steps.map((step) =>
      overrideWorkflowStep(step, override),
    ),
  };
}

const EVAL_RUNTIME_ENV_PATHS = {
	HOME: "home",
	COREPACK_HOME: "corepack",
	PNPM_HOME: "pnpm-home",
	XDG_CACHE_HOME: "cache",
	XDG_DATA_HOME: "data",
	XDG_STATE_HOME: "state",
	npm_config_cache: "npm-cache",
	npm_config_store_dir: "pnpm-store",
} as const;

function gitOutput(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: withProtectedGitBareRepositoryEnv(),
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

/**
 * Eval subprocesses already carry a closed set of runner-owned path facts.
 * Require all of them, plus an independent repository root and the harness's
 * local Git identity, before allowing a standalone runtime host.
 */
export function isPositivelyIdentifiedIsolatedEvalRoot(
	workspaceRoot: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	try {
		const root = realpathSync(workspaceRoot);
		if (!basename(root).startsWith("kota-eval-")) return false;
		if (existsSync(join(root, ".kota", "daemon-control.json"))) return false;
		if (env.KOTA_SCOPE_ROOT === undefined) return false;
		const declaredRoot = resolve(env.KOTA_SCOPE_ROOT);
		if (realpathSync(declaredRoot) !== root) return false;
		const runtimeRoot = join(declaredRoot, "node_modules", ".kota-eval-runtime");
		for (const [key, leaf] of Object.entries(EVAL_RUNTIME_ENV_PATHS)) {
			const value = env[key];
			if (value === undefined || resolve(value) !== resolve(runtimeRoot, leaf)) {
				return false;
			}
		}
		if (realpathSync(gitOutput(root, ["rev-parse", "--show-toplevel"])) !== root) {
			return false;
		}
		const commonDirValue = gitOutput(root, ["rev-parse", "--git-common-dir"]);
		const commonDir = realpathSync(
			isAbsolute(commonDirValue)
				? commonDirValue
				: resolve(root, commonDirValue),
		);
		if (commonDir !== realpathSync(join(root, ".git"))) return false;
		return gitOutput(root, ["config", "--get", "user.email"]) ===
			"eval-harness@kota.local";
	} catch {
		return false;
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForDaemonWorkflowRun(
	client: WorkflowClient,
	runId: string,
): Promise<Extract<Awaited<ReturnType<WorkflowClient["getRun"]>>, { found: true }>["run"]> {
	for (;;) {
		const result = await client.getRun(runId);
		if (result.found && result.run.status !== "running") return result.run;
		await wait(50);
	}
}

async function executeCanonicalWorkflow(
	ctx: ModuleContext,
	name: string,
	event: string,
	payload: Record<string, unknown> | undefined,
): Promise<void> {
	const scopeId = deriveDirectoryScopeId(ctx.cwd);
	const client = ctx.client.forScope(scopeId);
	const definitions = await client.workflow.listDefinitions();
	if (definitions.source !== "daemon") {
		throw new Error(
			`Cannot execute canonical workflow "${name}": no daemon-owned workflow authority is available for ${ctx.cwd}`,
		);
	}
	const definition = definitions.definitions.find((candidate) => candidate.name === name);
	if (definition === undefined) {
		const names = definitions.definitions.map((candidate) => candidate.name).join(", ");
		throw new Error(`Unknown workflow "${name}". Available: ${names}`);
	}
	if (!definition.enabled || definition.runtimeEnabled === false) {
		throw new Error(`Workflow "${name}" is disabled.`);
	}
	const requestedRunId = typeof payload?._runId === "string"
		? payload._runId
		: formatRunId(name);
	const admission = await client.workflow.triggerByName(name, {
		event,
		...(payload !== undefined ? { payload } : {}),
		runId: requestedRunId,
	});
	if (!admission.ok) {
		throw new Error(
			admission.reason === "daemon_required"
				? `Cannot execute canonical workflow "${name}": daemon-owned workflow authority is unavailable`
				: `Cannot execute canonical workflow "${name}": the run is already queued`,
		);
	}
	const runId = admission.runId ?? requestedRunId;
	const run = await waitForDaemonWorkflowRun(client.workflow, runId);
	printWorkflowText(run.id);
	if (run.status !== "success" && run.status !== "completed-with-warnings") {
		process.exitCode = 1;
	}
}

/**
 * `kota workflow exec <name>` — synchronously execute one workflow run to
 * terminal status. Canonical checkouts dispatch through the daemon control
 * plane. Only eval-harness roots positively identified from runner-owned
 * isolation facts may construct a standalone runtime host.
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
		"Synchronously execute one workflow run through its authoritative runtime.",
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

		if (!isPositivelyIdentifiedIsolatedEvalRoot(ctx.cwd)) {
			if (agentExecutionOverride !== undefined) {
				printWorkflowError(
					"Canonical workflow execution does not support per-run agent overrides through the daemon client API; --agent-harness, --agent-model, and --agent-effort are restricted to isolated eval roots.",
				);
				process.exitCode = 1;
				return;
			}
			try {
				await executeCanonicalWorkflow(
					ctx,
					name,
					opts.event,
					extraPayload,
				);
			} catch (error) {
				printWorkflowError(
					error instanceof Error ? error.message : String(error),
				);
				process.exitCode = 1;
			}
			return;
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
          defaultAgentEffort: runtime.effort,
          preset: runtime.preset,
          modelTiers: runtime.tiers,
          agentModels: runtimeConfig.agentModels,
          resolveAgentDef: (agentName: string) => runtimeLoader.getAgentDef(agentName),
        };
        const workflowInputs = runtimeLoader.getContributedWorkflows();
        const definitions = validateWorkflowDefinitions(
          workflowInputs,
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
        const definitionInput = workflowInputs.find((candidate) => candidate.name === name);
        if (definitionInput === undefined) {
          throw new Error(`Workflow "${name}" disappeared after validation.`);
        }
        const executionInput = agentExecutionOverride === undefined
          ? definitionInput
          : overrideWorkflowAgentExecution(definitionInput, agentExecutionOverride);

        const scopeId = deriveDirectoryScopeId(ctx.cwd);
        const stateDir = mkdtempSync(join(tmpdir(), "kota-workflow-exec-"));
        const workflows = workflowInputs.map((candidate) =>
          candidate.name === executionInput.name
            ? executionInput
            : candidate,
        );
        let host: StandaloneRunHost | undefined;
        try {
			host = new StandaloneRunHost({
            stateDir,
            scope: {
              scopeId: scopeId,
              scopeRoot: ctx.cwd,
              displayName: scopeId,
            },
				bus,
				providerRegistry: runtimeLoader.getProviderRegistry(),
            config: runtimeConfig,
            workflows,
            resolveAgentDef: (agentName) => runtimeLoader.getAgentDef(agentName),
            resolveSkillsPrompt: (names, agentName) =>
              runtimeLoader.getSkillsPromptFor(names, agentName),
            onLog: (message) => printWorkflowError(message),
          });
          const requestedRunId = typeof extraPayload?._runId === "string"
            ? extraPayload._runId
            : undefined;
          const result = await host.runToTerminal(name, {
            event: opts.event,
            payload: extraPayload,
            runId: requestedRunId,
          });
          printWorkflowText(result.run.id);
          if (result.run.state !== "succeeded") process.exitCode = 1;
        } finally {
          await host?.close();
          rmSync(stateDir, { force: true, recursive: true });
        }
      } finally {
        await runtimeLoader.unloadAll();
      }
    });
}
