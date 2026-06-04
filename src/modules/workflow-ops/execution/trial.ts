import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Command } from "commander";
import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import { type KotaConfig, loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId, loadRegistryFileFromDisk } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { PRESET_ENV_VAR, resolvePreset } from "#core/model/preset.js";
import type { ControlRouteRegistration, ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { executeTool, getToolEffect } from "#core/tools/index.js";
import { executeWorkflowRun, type RunExecutorDeps } from "#core/workflow/run-executor.js";
import { ensureDir, formatRunId, writeJsonFile } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import type {
  WorkflowTrialAttemptReport,
  WorkflowTrialBlockedSideEffect,
  WorkflowTrialChangedFile,
  WorkflowTrialEvent,
  WorkflowTrialOptions,
  WorkflowTrialPayload,
  WorkflowTrialResult,
  WorkflowTrialSummary,
} from "../client.js";

type FileSnapshot = Map<string, string>;

type WorkflowTrialRuntime = {
  config: KotaConfig;
  definitions: WorkflowDefinition[];
  resolveAgentDef?: ModuleContext["resolveAgentDef"];
  resolveSkillsPrompt?: ModuleContext["resolveSkillsPrompt"];
  unload?: () => Promise<void>;
};

export type WorkflowTrialRuntimeFactory = (
  trialProjectDir: string,
) => Promise<WorkflowTrialRuntime>;

export type RunWorkflowTrialArgs = {
  sourceProjectDir: string;
  workflowName: string;
  options?: WorkflowTrialOptions;
  runtimeFactory: WorkflowTrialRuntimeFactory;
};

type TrialVariant = {
  label: string;
  workflow: string;
  payload: WorkflowTrialPayload;
};

type QueuedWorkflowReport = WorkflowTrialAttemptReport["queuedWorkflows"][number];
type WorkflowRuntimePayload = WorkflowRunTrigger["payload"];
type TrialRequestBody = Awaited<ReturnType<typeof readBody>>;
type JsonParseResult = ReturnType<typeof JSON.parse>;
type TrialToolInput = Parameters<WorkflowStepContext["runTool"]>[1];
type TrialToolScopeResult =
  | { ok: true; input: TrialToolInput }
  | { ok: false; message: string };
type TrialPathResult =
  | { ok: true; path: string }
  | { ok: false; message: string };
type TrialProjectResolution =
  | { ok: true; sourceProjectDir: string; projectId: string }
  | { ok: false; projectId: string; message: string };

const TRIAL_SCOPED_LOCAL_TOOLS = new Set([
  "file_read",
  "file_write",
  "file_edit",
  "multi_edit",
  "find_replace",
  "glob",
  "grep",
  "file_watch",
  "files_overview",
  "repo_map",
  "view_image",
  "sqlite",
  "notebook",
]);

function clonePayload(
  payload: WorkflowTrialPayload | WorkflowRuntimePayload,
): WorkflowTrialPayload {
  return JSON.parse(JSON.stringify(payload)) as WorkflowTrialPayload;
}

function pathIsWithinRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function scopeTrialPath(
  trialProjectDir: string,
  rawPath: string,
  label: string,
): TrialPathResult {
  const scoped = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(trialProjectDir, rawPath);
  if (!pathIsWithinRoot(trialProjectDir, scoped)) {
    return {
      ok: false,
      message: `${label} resolves outside the isolated trial project: ${rawPath}`,
    };
  }
  return { ok: true, path: scoped };
}

function scopePathField(
  input: TrialToolInput,
  field: string,
  trialProjectDir: string,
  fallback?: string,
): TrialToolScopeResult {
  const raw = input[field] ?? fallback;
  if (raw === undefined) return { ok: true, input };
  if (typeof raw !== "string") return { ok: true, input };
  const scoped = scopeTrialPath(trialProjectDir, raw, field);
  if (!scoped.ok) return { ok: false, message: scoped.message };
  return { ok: true, input: { ...input, [field]: scoped.path } };
}

function scopeMultiEditInput(
  input: TrialToolInput,
  trialProjectDir: string,
): TrialToolScopeResult {
  const edits = input.edits;
  if (!Array.isArray(edits)) return { ok: true, input };
  const scopedEdits = [];
  for (const edit of edits) {
    if (typeof edit !== "object" || edit === null || Array.isArray(edit)) {
      scopedEdits.push(edit);
      continue;
    }
    const path = "path" in edit ? edit.path : undefined;
    if (typeof path !== "string") {
      scopedEdits.push(edit);
      continue;
    }
    const scoped = scopeTrialPath(trialProjectDir, path, "edits[].path");
    if (!scoped.ok) return { ok: false, message: scoped.message };
    scopedEdits.push({ ...edit, path: scoped.path });
  }
  return { ok: true, input: { ...input, edits: scopedEdits } };
}

function scopeTrialToolInput(
  tool: string,
  input: TrialToolInput,
  trialProjectDir: string,
): TrialToolScopeResult {
  switch (tool) {
    case "file_read":
    case "file_write":
    case "file_edit":
    case "file_watch":
    case "view_image":
    case "notebook":
      return scopePathField(input, "path", trialProjectDir);
    case "multi_edit":
      return scopeMultiEditInput(input, trialProjectDir);
    case "find_replace":
      return scopePathField(input, "files", trialProjectDir);
    case "glob":
    case "grep":
    case "files_overview":
      return scopePathField(input, "path", trialProjectDir, ".");
    case "repo_map":
      return scopePathField(input, "directory", trialProjectDir, ".");
    case "sqlite":
      return scopePathField(input, "database", trialProjectDir);
    case "shell":
      return scopePathField(input, "cwd", trialProjectDir, ".");
    default:
      return { ok: true, input };
  }
}

function trialBlockedReason(
  tool: string,
  effect: NonNullable<ReturnType<typeof getToolEffect>>,
  opts: { canScopeLocalFs: boolean },
): string | undefined {
  if (effect.kind === "destructive") {
    return "tool would produce a destructive side effect in trial mode";
  }
  if (effect.scope === "external-network" || effect.scope === "operator-surface") {
    return "tool would produce a live external or operator-visible side effect in trial mode";
  }
  if (effect.scope === "daemon-state" && effect.kind !== "read") {
    return "tool would mutate daemon state outside the isolated trial project";
  }
  if (effect.scope === "process-env" && effect.kind !== "read") {
    return "tool would mutate the daemon process environment in trial mode";
  }
  if (
    effect.scope === "local-fs" &&
    effect.kind !== "read" &&
    !opts.canScopeLocalFs
  ) {
    return `tool "${tool}" has local filesystem side effects that trial mode cannot root in the isolated project`;
  }
  return undefined;
}

function buildBlockedSideEffect(
  stepId: string,
  tool: string,
  reason: string,
  effect: NonNullable<ReturnType<typeof getToolEffect>>,
): WorkflowTrialBlockedSideEffect {
  return {
    stepId,
    tool,
    reason,
    effect: {
      kind: effect.kind,
      scope: effect.scope,
      openWorld: effect.openWorld,
    },
  };
}

async function runTrialTool(
  args: {
    trialProjectDir: string;
    stepId: string;
    blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[];
  },
  name: string,
  input: TrialToolInput,
): Promise<Awaited<ReturnType<WorkflowStepContext["runTool"]>>> {
  const effect = getToolEffect(name);
  if (effect) {
    const reason = trialBlockedReason(name, effect, {
      canScopeLocalFs: TRIAL_SCOPED_LOCAL_TOOLS.has(name),
    });
    if (reason) {
      args.blockedExternalSideEffects.push(
        buildBlockedSideEffect(args.stepId, name, reason, effect),
      );
      throw new Error(`Blocked in workflow trial mode: ${reason}`);
    }
  }

  const scoped = scopeTrialToolInput(name, input, args.trialProjectDir);
  if (!scoped.ok) {
    if (effect && effect.kind !== "read") {
      args.blockedExternalSideEffects.push(
        buildBlockedSideEffect(args.stepId, name, scoped.message, effect),
      );
    }
    throw new Error(`Blocked in workflow trial mode: ${scoped.message}`);
  }

  const result = await executeTool(name, scoped.input);
  if (result.is_error) {
    throw new Error(result.content);
  }
  return result;
}

function createTrialAgentToolGuard(args: {
  trialProjectDir: string;
  stepId: string;
  blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[];
}): AgentCanUseTool {
  return async (name, input) => {
    const effect = getToolEffect(name);
    if (effect) {
      const reason = trialBlockedReason(name, effect, {
        canScopeLocalFs: TRIAL_SCOPED_LOCAL_TOOLS.has(name),
      });
      if (reason) {
        args.blockedExternalSideEffects.push(
          buildBlockedSideEffect(args.stepId, name, reason, effect),
        );
        return {
          behavior: "deny",
          message: `Blocked in workflow trial mode: ${reason}`,
          decisionAttribution: "operator-deny",
        };
      }
    }

    const scoped = scopeTrialToolInput(name, input, args.trialProjectDir);
    if (!scoped.ok) {
      if (effect && effect.kind !== "read") {
        args.blockedExternalSideEffects.push(
          buildBlockedSideEffect(args.stepId, name, scoped.message, effect),
        );
      }
      return {
        behavior: "deny",
        message: `Blocked in workflow trial mode: ${scoped.message}`,
        decisionAttribution: "operator-deny",
      };
    }

    return { behavior: "allow", updatedInput: scoped.input };
  };
}

class WorkflowTrialRequestError extends Error {
  constructor(
    message: string,
    readonly reason: "invalid_request" | "unknown_workflow",
  ) {
    super(message);
  }
}

function isJsonValue(value: JsonParseResult): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

function isJsonObject(value: JsonParseResult): value is WorkflowTrialPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function parseJsonObject(value: string, label: string): WorkflowTrialPayload {
  const parsed = JSON.parse(value);
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function collectValue<T>(value: T, previous: T[]): T[] {
  return [...previous, value];
}

function normalizeRepeat(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new WorkflowTrialRequestError("--repeat must be an integer from 1 to 20", "invalid_request");
  }
  return value;
}

function buildVariants(
  workflowName: string,
  options: WorkflowTrialOptions | undefined,
): TrialVariant[] {
  const payload = clonePayload(options?.payload ?? {});
  const variants: TrialVariant[] = [
    { label: "primary", workflow: workflowName, payload },
  ];
  for (const workflow of options?.compareWorkflows ?? []) {
    if (workflow !== workflowName) {
      variants.push({
        label: `workflow-${workflow}`,
        workflow,
        payload: clonePayload(payload),
      });
    }
  }
  for (let i = 0; i < (options?.comparePayloads ?? []).length; i++) {
    const comparePayload = options!.comparePayloads![i]!;
    variants.push({
      label: `payload-${i + 1}`,
      workflow: workflowName,
      payload: clonePayload(comparePayload),
    });
  }
  return variants;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attempt";
}

function shouldCopyPath(sourceProjectDir: string, path: string): boolean {
  const rel = relative(sourceProjectDir, path);
  if (!rel) return true;
  const parts = rel.split("/");
  if (parts.includes(".git") || parts.includes("node_modules")) return false;
  if (parts[0] === "dist") return false;
  if (parts[0] === ".kota") {
    const second = parts[1];
    if (second === "runs" || second === "eval-runs" || second === "task-archive") {
      return false;
    }
    const leaf = parts[parts.length - 1];
    if (
      leaf === "daemon-control.json" ||
      leaf === "daemon-state.json" ||
      leaf === "daemon.log" ||
      leaf === "workflow-state.json" ||
      leaf === "audit.jsonl"
    ) {
      return false;
    }
  }
  return true;
}

function copyProjectForTrial(sourceProjectDir: string, attemptId: string): string {
  const root = join(tmpdir(), `kota-workflow-trial-${safeSegment(attemptId)}-${Date.now()}`);
  const trialProjectDir = join(root, basename(sourceProjectDir));
  cpSync(sourceProjectDir, trialProjectDir, {
    recursive: true,
    filter: (src) => shouldCopyPath(sourceProjectDir, src),
  });
  ensureDir(join(trialProjectDir, ".kota"));
  return trialProjectDir;
}

function shouldSnapshotPath(rel: string): boolean {
  if (!rel) return true;
  const parts = rel.split("/");
  return !parts.includes(".git") && !parts.includes("node_modules") && parts[0] !== "dist";
}

function snapshotFiles(root: string): FileSnapshot {
  const snapshot: FileSnapshot = new Map();
  if (!existsSync(root)) return snapshot;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = relative(root, path);
      if (!shouldSnapshotPath(rel)) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      if (!stat.isFile()) continue;
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      snapshot.set(rel, digest);
    }
  };
  visit(root);
  return snapshot;
}

function diffSnapshots(before: FileSnapshot, after: FileSnapshot): WorkflowTrialChangedFile[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].sort().flatMap((path): WorkflowTrialChangedFile[] => {
    const beforeHash = before.get(path);
    const afterHash = after.get(path);
    if (beforeHash === undefined && afterHash !== undefined) {
      return [{ path, change: "created" }];
    }
    if (beforeHash !== undefined && afterHash === undefined) {
      return [{ path, change: "deleted" }];
    }
    if (beforeHash !== afterHash) {
      return [{ path, change: "modified" }];
    }
    return [];
  });
}

function isStoreMutation(file: WorkflowTrialChangedFile): boolean {
  return file.path.startsWith(".kota/") && !file.path.startsWith(".kota/runs/");
}

function isTaskMutation(file: WorkflowTrialChangedFile): boolean {
  return file.path.startsWith("data/tasks/");
}

function cloneChangedFile(file: WorkflowTrialChangedFile): WorkflowTrialChangedFile {
  return { path: file.path, change: file.change };
}

function stepStatuses(meta: WorkflowRunMetadata | undefined): WorkflowTrialAttemptReport["stepStatuses"] {
  return (meta?.steps ?? []).map((step) => ({
    id: step.id,
    type: step.type,
    status: step.status,
    durationMs: step.durationMs,
  }));
}

async function runAttempt(args: {
  sourceProjectDir: string;
  reportDirPath: string;
  variant: TrialVariant;
  repeatIndex: number;
  runtimeFactory: WorkflowTrialRuntimeFactory;
}): Promise<WorkflowTrialAttemptReport> {
  const attemptId = `${safeSegment(args.variant.label)}-${args.repeatIndex + 1}`;
  const trialProjectDir = copyProjectForTrial(args.sourceProjectDir, attemptId);
  const before = snapshotFiles(trialProjectDir);
  const attemptReportPath = join(args.reportDirPath, "attempts", `${attemptId}.json`);
  ensureDir(join(args.reportDirPath, "attempts"));

  let runtime: WorkflowTrialRuntime | undefined;
  const busEvents: WorkflowTrialEvent[] = [];
  const queuedWorkflows: QueuedWorkflowReport[] = [];
  let metadata: WorkflowRunMetadata | undefined;
  const blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[] = [];
  let error: string | undefined;

  try {
    runtime = await args.runtimeFactory(trialProjectDir);
    const definition = runtime.definitions.find((d) => d.name === args.variant.workflow);
    if (!definition) {
      throw new WorkflowTrialRequestError(
        `Workflow "${args.variant.workflow}" not found`,
        "unknown_workflow",
      );
    }
    const bus = new EventBus();
    bus.on("*", (event) => {
      busEvents.push({
        type: event.type,
        schemaRef: event.schemaRef,
        payload: clonePayload(event.payload),
      });
    });
    const pbus = new ProjectScopedEventBus(bus, deriveDirectoryScopeId(trialProjectDir));
    const store = new WorkflowRunStore(trialProjectDir);
    const runId = formatRunId(`${args.variant.workflow}-trial`);
    const trigger: WorkflowRunTrigger = {
      event: "manual",
      schemaRef: null,
      payload: {
        ...args.variant.payload,
        triggeredAt: new Date().toISOString(),
        _runId: runId,
      },
    };

    const triggerWorkflow: NonNullable<RunExecutorDeps["triggerWorkflow"]> = async (
      workflowName,
      payload,
      waitFor,
      signal,
    ) => {
      const childRunId = formatRunId(`${workflowName}-trial-child`);
      const childTrigger: WorkflowRunTrigger = {
        event: "trial.triggered",
        schemaRef: null,
        payload: {
          ...payload,
          triggeredAt: new Date().toISOString(),
          _runId: childRunId,
        },
      };
      if (waitFor === "completed") {
        const childDefinition = runtime!.definitions.find((d) => d.name === workflowName);
        if (!childDefinition) {
          throw new Error(`Triggered workflow "${workflowName}" not found`);
        }
        const childAbortController = new AbortController();
        if (signal) {
          if (signal.aborted) {
            childAbortController.abort(signal.reason);
          } else {
            signal.addEventListener(
              "abort",
              () => childAbortController.abort(signal.reason),
              { once: true },
            );
          }
        }
        const child = executeWorkflowRun(childDefinition, childTrigger, {
          projectDir: trialProjectDir,
          bus,
          pbus,
          store,
          config: runtime!.config,
          log: () => {},
          triggerWorkflow,
          runTool: (name, input, context) =>
            runTrialTool(
              {
                trialProjectDir,
                stepId: context?.stepId ?? "unknown",
                blockedExternalSideEffects,
              },
              name,
              input,
            ),
          createAgentCanUseTool: (stepId) =>
            createTrialAgentToolGuard({
              trialProjectDir,
              stepId,
              blockedExternalSideEffects,
            }),
          resolveAgentDef: runtime!.resolveAgentDef,
          resolveSkillsPrompt: runtime!.resolveSkillsPrompt,
        }, childAbortController);
        const childResult = await child.promise;
        const childStatus =
          childResult.metadata.status === "success" ||
          childResult.metadata.status === "completed-with-warnings"
            ? "completed"
            : "failed";
        queuedWorkflows.push({
          workflow: workflowName,
          runId: childRunId,
          waitFor,
          payload: clonePayload(payload),
          status: childStatus,
        });
        return { runId: childRunId, status: childStatus };
      }

      const state = store.readState();
      const now = Date.now();
      store.setPendingRuns([
        ...state.pendingRuns,
        {
          runId: childRunId,
          workflowName,
          trigger: childTrigger,
          enqueuedAtMs: now,
          notBeforeMs: now,
        },
      ]);
      queuedWorkflows.push({
        workflow: workflowName,
        runId: childRunId,
        waitFor,
        payload: clonePayload(payload),
        status: "queued",
      });
      return { runId: childRunId, status: "queued" };
    };

    const { promise } = executeWorkflowRun(definition, trigger, {
      projectDir: trialProjectDir,
      bus,
      pbus,
      store,
      config: runtime.config,
      log: () => {},
      triggerWorkflow,
      runTool: (name, input, context) =>
        runTrialTool(
          {
            trialProjectDir,
            stepId: context?.stepId ?? "unknown",
            blockedExternalSideEffects,
          },
          name,
          input,
        ),
      createAgentCanUseTool: (stepId) =>
        createTrialAgentToolGuard({
          trialProjectDir,
          stepId,
          blockedExternalSideEffects,
        }),
      resolveAgentDef: runtime.resolveAgentDef,
      resolveSkillsPrompt: runtime.resolveSkillsPrompt,
    });
    const result = await promise;
    metadata = result.metadata;
    if (
      metadata.status !== "success" &&
      metadata.status !== "completed-with-warnings"
    ) {
      const failedStep = metadata.steps.find((step) => step.status === "failed");
      error = failedStep?.error ?? `workflow finished with status ${metadata.status}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await runtime?.unload?.();
  }

  const after = snapshotFiles(trialProjectDir);
  const changedFiles = diffSnapshots(before, after);
  const status: WorkflowTrialAttemptReport["status"] =
    blockedExternalSideEffects.length > 0
      ? "blocked"
      : error
        ? "failed"
        : "passed";
  const report: WorkflowTrialAttemptReport = {
    id: attemptId,
    workflow: args.variant.workflow,
    payload: clonePayload(args.variant.payload),
    status,
    trialProjectPath: trialProjectDir,
    ...(metadata?.id !== undefined && { workflowRunId: metadata.id }),
    stepStatuses: stepStatuses(metadata),
    changedFiles,
    taskMutations: changedFiles.filter(isTaskMutation).map(cloneChangedFile),
    storeMutations: changedFiles.filter(isStoreMutation).map(cloneChangedFile),
    busEvents,
    queuedWorkflows,
    blockedExternalSideEffects,
    reportPath: relative(args.sourceProjectDir, attemptReportPath),
    ...(error !== undefined && { error }),
  };
  writeJsonFile(attemptReportPath, report);
  return report;
}

export async function runWorkflowTrial(
  args: RunWorkflowTrialArgs,
): Promise<WorkflowTrialSummary> {
  const repeat = normalizeRepeat(args.options?.repeat);
  const variants = buildVariants(args.workflowName, args.options);
  const runId = formatRunId("workflow-trial");
  const reportDirPath = join(args.sourceProjectDir, ".kota", "runs", runId, "workflow-trial");
  ensureDir(reportDirPath);

  const attempts: WorkflowTrialAttemptReport[] = [];
  for (const variant of variants) {
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex++) {
      attempts.push(await runAttempt({
        sourceProjectDir: args.sourceProjectDir,
        reportDirPath,
        variant,
        repeatIndex,
        runtimeFactory: args.runtimeFactory,
      }));
    }
  }

  const passed = attempts.filter((a) => a.status === "passed").length;
  const failed = attempts.filter((a) => a.status === "failed").length;
  const blocked = attempts.filter((a) => a.status === "blocked").length;
  const summary: WorkflowTrialSummary = {
    runId,
    workflow: args.workflowName,
    projectId: args.options?.projectId ?? deriveDirectoryScopeId(args.sourceProjectDir),
    sourceProjectPath: args.sourceProjectDir,
    reportDir: relative(args.sourceProjectDir, reportDirPath),
    payload: clonePayload(args.options?.payload ?? {}),
    repeat,
    attempts,
    comparison: {
      workflows: args.options?.compareWorkflows ?? [],
      payloadVariants: (args.options?.comparePayloads ?? []).map((payload) =>
        clonePayload(payload),
      ),
    },
    passed,
    failed,
    blocked,
    status: failed === 0 && blocked === 0 ? "passed" : "failed",
  };
  writeJsonFile(join(reportDirPath, "summary.json"), summary);
  return summary;
}

export function createDefaultWorkflowTrialRuntimeFactory(): WorkflowTrialRuntimeFactory {
  return async (trialProjectDir: string) => {
    const runtimeConfig = loadConfig(trialProjectDir);
    const runtimeLoader = await loadRuntimeModules({
      config: runtimeConfig,
      cwd: trialProjectDir,
    });
    try {
      const { preset } = resolvePreset({
        env: process.env[PRESET_ENV_VAR],
        config: runtimeConfig.defaultPreset,
      });
      const definitions = validateWorkflowDefinitions(
        runtimeLoader.getContributedWorkflows(),
        trialProjectDir,
        {
          defaultAgentHarness: runtimeConfig.defaultAgentHarness ?? preset.harness,
          preset,
          modelTiers: runtimeConfig.modelTiers,
        },
      );
      return {
        config: runtimeConfig,
        definitions,
        resolveAgentDef: (name) => runtimeLoader.getAgentDef(name),
        resolveSkillsPrompt: (names, agentName) =>
          runtimeLoader.getSkillsPromptFor(names, agentName),
        unload: () => runtimeLoader.unloadAll(),
      };
    } catch (err) {
      await runtimeLoader.unloadAll();
      throw err;
    }
  };
}

function resolveWorkflowTrialProject(
  ctx: ModuleContext,
  options: WorkflowTrialOptions | undefined,
): TrialProjectResolution {
  const requestedProjectId = options?.projectId;
  const defaultProjectId = deriveDirectoryScopeId(ctx.cwd);
  if (requestedProjectId === undefined || requestedProjectId === defaultProjectId) {
    return {
      ok: true,
      sourceProjectDir: ctx.cwd,
      projectId: defaultProjectId,
    };
  }

  const registry = loadRegistryFileFromDisk(join(ctx.cwd, ".kota"));
  const project = registry?.projects.find((entry) => entry.projectId === requestedProjectId);
  if (!project) {
    return {
      ok: false,
      projectId: requestedProjectId,
      message: `Unknown project: ${requestedProjectId}`,
    };
  }
  return {
    ok: true,
    sourceProjectDir: project.projectDir,
    projectId: project.projectId,
  };
}

export async function runLocalWorkflowTrial(
  ctx: ModuleContext,
  name: string,
  options?: WorkflowTrialOptions,
): Promise<WorkflowTrialResult> {
  try {
    const project = resolveWorkflowTrialProject(ctx, options);
    if (!project.ok) {
      return {
        ok: false,
        reason: "unknown_project",
        message: project.message,
      };
    }
    const summary = await runWorkflowTrial({
      sourceProjectDir: project.sourceProjectDir,
      workflowName: name,
      options: { ...(options ?? {}), projectId: project.projectId },
      runtimeFactory: createDefaultWorkflowTrialRuntimeFactory(),
    });
    return { ok: true, summary };
  } catch (err) {
    if (err instanceof WorkflowDefinitionError) {
      return {
        ok: false,
        reason: "invalid_request",
        message: `Definition error: ${err.message}`,
      };
    }
    if (err instanceof WorkflowTrialRequestError) {
      return { ok: false, reason: err.reason, message: err.message };
    }
    return {
      ok: false,
      reason: "invalid_request",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseTrialOptionsFromBody(body: TrialRequestBody): {
  name?: string;
  options: WorkflowTrialOptions;
} {
  const name = typeof body.name === "string" ? body.name : undefined;
  const payload =
    isJsonObject(body.payload)
      ? body.payload
      : undefined;
  const repeat =
    body.repeat !== undefined && typeof body.repeat === "number"
      ? body.repeat
      : undefined;
  const compareWorkflows =
    Array.isArray(body.compareWorkflows) &&
    body.compareWorkflows.every((entry) => typeof entry === "string")
      ? body.compareWorkflows
      : undefined;
  const comparePayloads =
    Array.isArray(body.comparePayloads) &&
    body.comparePayloads.every(isJsonObject)
      ? body.comparePayloads
      : undefined;
  const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
  return {
    name,
    options: {
      ...(payload !== undefined && { payload }),
      ...(repeat !== undefined && { repeat }),
      ...(compareWorkflows !== undefined && { compareWorkflows }),
      ...(comparePayloads !== undefined && { comparePayloads }),
      ...(projectId !== undefined && { projectId }),
    },
  };
}

export async function handleWorkflowTrialControl(
  ctx: ModuleContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: TrialRequestBody;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }
  const { name, options } = parseTrialOptionsFromBody(body);
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
    return;
  }
  const result = await runLocalWorkflowTrial(ctx, name, options);
  if (!result.ok) {
    if (result.reason === "unknown_project") {
      jsonResponse(res, 404, {
        error: "Unknown project",
        reason: "unknown_project",
        projectId: options.projectId,
      });
      return;
    }
    jsonResponse(res, result.reason === "unknown_workflow" ? 404 : 400, {
      error: result.message,
      reason: result.reason,
    });
    return;
  }
  jsonResponse(res, 200, result);
}

export function workflowTrialControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/workflow/trial",
      capabilityScope: "control",
      handler: (req, res) => handleWorkflowTrialControl(ctx, req, res),
    },
  ];
}

function parseTrialCliOptions(opts: {
  payload?: string;
  repeat?: string;
  compareWorkflow: string[];
  comparePayload: string[];
}): WorkflowTrialOptions {
  const payload = opts.payload ? parseJsonObject(opts.payload, "--payload") : undefined;
  const repeat = opts.repeat === undefined ? undefined : Number.parseInt(opts.repeat, 10);
  if (opts.repeat !== undefined && Number.isNaN(repeat)) {
    throw new Error("--repeat must be an integer");
  }
  const comparePayloads = opts.comparePayload.map((raw) =>
    parseJsonObject(raw, "--compare-payload"),
  );
  return {
    ...(payload !== undefined && { payload }),
    ...(repeat !== undefined && { repeat }),
    ...(opts.compareWorkflow.length > 0 && { compareWorkflows: opts.compareWorkflow }),
    ...(comparePayloads.length > 0 && { comparePayloads }),
  };
}

export function formatWorkflowTrialSummary(summary: WorkflowTrialSummary): string {
  const lines = [
    `Workflow trial ${summary.runId}: ${summary.status}`,
    `Report: ${summary.reportDir}/summary.json`,
    `Attempts: ${summary.passed} passed, ${summary.failed} failed, ${summary.blocked} blocked`,
  ];
  for (const attempt of summary.attempts) {
    const run = attempt.workflowRunId ? ` run=${attempt.workflowRunId}` : "";
    const changed = ` changed=${attempt.changedFiles.length}`;
    const events = ` events=${attempt.busEvents.length}`;
    lines.push(`- ${attempt.id} ${attempt.workflow}: ${attempt.status}${run}${changed}${events}`);
  }
  return lines.join("\n");
}

export function registerTrialCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("trial <name>")
    .description("Execute a real workflow run against an isolated temporary project and write a trial report")
    .option("--payload <json>", "JSON object merged into the trial trigger payload")
    .option("--repeat <n>", "Run each trial variant N times", "1")
    .option("--compare-workflow <name>", "Additional workflow to run with the same payload", collectValue, [] as string[])
    .option("--compare-payload <json>", "Additional JSON payload variant to run against the primary workflow", collectValue, [] as string[])
    .action(async (
      name: string,
      opts: {
        payload?: string;
        repeat?: string;
        compareWorkflow: string[];
        comparePayload: string[];
      },
    ) => {
      let options: WorkflowTrialOptions;
      try {
        options = parseTrialCliOptions(opts);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      let result: WorkflowTrialResult;
      try {
        result = await ctx.client.workflow.trial(name, options);
      } catch {
        result = await runLocalWorkflowTrial(ctx, name, options);
      }
      if (!result.ok && result.reason === "daemon_required") {
        result = await runLocalWorkflowTrial(ctx, name, options);
      }
      if (!result.ok) {
        console.error(result.message);
        process.exit(1);
      }
      console.log(formatWorkflowTrialSummary(result.summary));
      if (result.summary.status !== "passed") {
        process.exitCode = 1;
      }
    });
}
