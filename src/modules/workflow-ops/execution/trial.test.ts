import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { KotaConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId, ScopeRegistry } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  credentialInjectionEffect,
  daemonWriteEffect,
  localWriteEffect,
  networkDestructiveEffect,
} from "#core/tools/effect.js";
import { deregisterTool, executeTool, registerTool } from "#core/tools/index.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { fileWriteTool, runFileWrite } from "#modules/filesystem/file-write.js";
import {
  registerTrialCommand,
  runLocalWorkflowTrial,
  runWorkflowTrial,
  type WorkflowTrialRuntimeFactory,
} from "./trial.js";

const EXTERNAL_TOOL = "workflow_trial_external_test";
const DAEMON_WRITE_TOOL = "workflow_trial_daemon_write_test";
const UNSCOPED_LOCAL_WRITE_TOOL = "workflow_trial_unscoped_local_write_test";
const PROCESS_ENV_TOOL = "workflow_trial_process_env_test";
const AGENT_HARNESS = "workflow_trial_agent_harness_test";
const PROCESS_ENV_AGENT_HARNESS = "workflow_trial_process_env_agent_harness_test";
const PROCESS_ENV_KEY = "KOTA_WORKFLOW_TRIAL_PROCESS_ENV_TEST";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-workflow-trial-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, "data", "tasks"), { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# Test Project\n", "utf-8");
  writeFileSync(join(dir, "data", "tasks", "AGENTS.md"), "# Tasks\n", "utf-8");
  return dir;
}

function writeProjectModule(projectDir: string, code: string): void {
  const moduleDir = join(projectDir, ".kota", "modules", "trial-fixture");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "index.mjs"), code, "utf-8");
}

function makeTrialCliProgram(ctx: { client: unknown; cwd: string }): Command {
  const program = new Command("workflow");
  program.exitOverride();
  registerTrialCommand(program, ctx as ModuleContext);
  return program;
}

function makeDefinition(
  projectDir: string,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    name: "trial-fixture",
    enabled: true,
    recoveryCapable: false,
    moduleRoot: projectDir,
    definitionPath: "fixture-workflow.ts",
    tags: [],
    triggers: [{ event: "manual", cooldownMs: 0 }],
    steps: [
      {
        id: "write-marker",
        type: "code",
        run: ({ projectDir: runProjectDir, trigger, emit }) => {
          mkdirSync(join(runProjectDir, "data"), { recursive: true });
          writeFileSync(
            join(runProjectDir, "data", "trial-marker.txt"),
            String(trigger.payload.marker ?? "missing"),
            "utf-8",
          );
          emit("trial.fixture", { marker: trigger.payload.marker ?? "missing" });
          return { ok: true };
        },
      },
    ],
    ...overrides,
  };
}

function makeRuntimeFactory(
  build: (projectDir: string) => WorkflowDefinition[],
): WorkflowTrialRuntimeFactory {
  return async (projectDir) => ({
    config: {} as KotaConfig,
    definitions: build(projectDir),
  });
}

describe("workflow trial execution", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    deregisterTool(EXTERNAL_TOOL);
    deregisterTool(DAEMON_WRITE_TOOL);
    deregisterTool(UNSCOPED_LOCAL_WRITE_TOOL);
    deregisterTool(PROCESS_ENV_TOOL);
    deregisterTool("file_write");
    deregisterTool("shell");
    delete process.env[PROCESS_ENV_KEY];
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs in an isolated project and reports changed files, steps, and bus events", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "trial-fixture",
      options: { payload: { marker: "isolated" } },
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir),
      ]),
    });

    expect(summary.status).toBe("passed");
    expect(summary.attempts).toHaveLength(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(existsSync(join(projectDir, "data", "trial-marker.txt"))).toBe(false);
    expect(readFileSync(join(attempt.trialProjectPath, "data", "trial-marker.txt"), "utf-8")).toBe("isolated");
    expect(attempt.changedFiles).toContainEqual({
      path: "data/trial-marker.txt",
      change: "created",
    });
    expect(attempt.stepStatuses).toEqual([
      expect.objectContaining({ id: "write-marker", status: "success" }),
    ]);
    expect(attempt.busEvents.some((event) => event.type === "trial.fixture")).toBe(true);
    expect(existsSync(join(projectDir, summary.reportDir, "summary.json"))).toBe(true);
  });

  it("roots local filesystem tool steps inside the isolated project copy", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    registerTool(fileWriteTool, runFileWrite, "workflow-trial-test", {
      effect: localWriteEffect(),
    });

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "tool-write-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "tool-write-fixture",
          steps: [
            {
              id: "write-marker-tool",
              type: "tool",
              tool: "file_write",
              input: {
                path: "data/tool-marker.txt",
                content: "trial tool write",
              },
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("passed");
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(existsSync(join(projectDir, "data", "tool-marker.txt"))).toBe(false);
    expect(readFileSync(join(attempt.trialProjectPath, "data", "tool-marker.txt"), "utf-8")).toBe("trial tool write");
    expect(attempt.changedFiles).toContainEqual({
      path: "data/tool-marker.txt",
      change: "created",
    });
  });

  it("blocks explicit external side-effect tool steps before execution", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    registerTool(
      {
        name: EXTERNAL_TOOL,
        description: "fixture external sender",
        input_schema: { type: "object", properties: {} },
      },
      async () => ({ content: "sent" }),
      "workflow-trial-test",
      { effect: networkDestructiveEffect() },
    );

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "external-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "external-fixture",
          steps: [{ id: "send-live", type: "tool", tool: EXTERNAL_TOOL }],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(attempt.workflowRunId).toBeDefined();
    expect(attempt.stepStatuses).toContainEqual(
      expect.objectContaining({ id: "send-live", status: "failed" }),
    );
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "send-live",
        tool: EXTERNAL_TOOL,
      }),
    ]);
  });

  it("blocks daemon-state and unscoped local write tool steps before execution", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const daemonRunner = vi.fn(async () => ({ content: "mutated daemon" }));
    const localRunner = vi.fn(async () => ({ content: "mutated local" }));
    registerTool(
      {
        name: DAEMON_WRITE_TOOL,
        description: "fixture daemon writer",
        input_schema: { type: "object", properties: {} },
      },
      daemonRunner,
      "workflow-trial-test",
      { effect: daemonWriteEffect() },
    );
    registerTool(
      {
        name: UNSCOPED_LOCAL_WRITE_TOOL,
        description: "fixture unscoped local writer",
        input_schema: { type: "object", properties: {} },
      },
      localRunner,
      "workflow-trial-test",
      { effect: localWriteEffect() },
    );

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "blocked-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "blocked-tool-fixture",
          steps: [
            { id: "write-daemon", type: "tool", tool: DAEMON_WRITE_TOOL, continueOnFailure: true },
            { id: "write-local", type: "tool", tool: UNSCOPED_LOCAL_WRITE_TOOL },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(attempt.workflowRunId).toBeDefined();
    expect(daemonRunner).not.toHaveBeenCalled();
    expect(localRunner).not.toHaveBeenCalled();
    expect(attempt.stepStatuses).toEqual([
      expect.objectContaining({ id: "write-daemon", status: "failed" }),
      expect.objectContaining({ id: "write-local", status: "failed" }),
    ]);
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "write-daemon",
        tool: DAEMON_WRITE_TOOL,
      }),
      expect.objectContaining({
        stepId: "write-local",
        tool: UNSCOPED_LOCAL_WRITE_TOOL,
      }),
    ]);
  });

  it("blocks process-env tool steps before they can mutate the daemon environment", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const processEnvRunner = vi.fn(async () => {
      process.env[PROCESS_ENV_KEY] = "mutated";
      return { content: "injected" };
    });
    registerTool(
      {
        name: PROCESS_ENV_TOOL,
        description: "fixture process env injector",
        input_schema: { type: "object", properties: {} },
      },
      processEnvRunner,
      "workflow-trial-test",
      { effect: credentialInjectionEffect() },
    );

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "process-env-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "process-env-fixture",
          steps: [{ id: "inject-process-env", type: "tool", tool: PROCESS_ENV_TOOL }],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(processEnvRunner).not.toHaveBeenCalled();
    expect(process.env[PROCESS_ENV_KEY]).toBeUndefined();
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "inject-process-env",
        tool: PROCESS_ENV_TOOL,
        effect: expect.objectContaining({ scope: "process-env" }),
      }),
    ]);
  });

  it("blocks shell tool steps instead of treating cwd rewriting as isolation", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const shellRunner = vi.fn(async () => ({ content: "ran shell" }));
    registerTool(
      {
        name: "shell",
        description: "fixture shell",
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
      },
      shellRunner,
      "workflow-trial-test",
      { effect: localWriteEffect() },
    );

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "shell-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "shell-fixture",
          steps: [
            {
              id: "run-shell",
              type: "tool",
              tool: "shell",
              input: {
                command: "touch /tmp/kota-trial-shell-escape",
                cwd: ".",
              },
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(attempt.workflowRunId).toBeDefined();
    expect(attempt.stepStatuses).toContainEqual(
      expect.objectContaining({ id: "run-shell", status: "failed" }),
    );
    expect(shellRunner).not.toHaveBeenCalled();
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "run-shell",
        tool: "shell",
        reason: expect.stringContaining("cannot root in the isolated project"),
      }),
    ]);
  });

  it("executes the runtime and skips unreachable dangerous tool declarations", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const externalRunner = vi.fn(async () => ({ content: "sent" }));
    registerTool(
      {
        name: EXTERNAL_TOOL,
        description: "fixture external sender",
        input_schema: { type: "object", properties: {} },
      },
      externalRunner,
      "workflow-trial-test",
      { effect: networkDestructiveEffect() },
    );

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "unreachable-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "unreachable-tool-fixture",
          steps: [
            {
              id: "safe-runtime-step",
              type: "code",
              run: ({ emit }) => {
                emit("trial.safe", { ok: true });
                return { ok: true };
              },
            },
            {
              id: "skipped-live-send",
              type: "tool",
              tool: EXTERNAL_TOOL,
              when: () => false,
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("passed");
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(externalRunner).not.toHaveBeenCalled();
    expect(attempt.blockedExternalSideEffects).toEqual([]);
    expect(attempt.stepStatuses).toEqual([
      expect.objectContaining({ id: "safe-runtime-step", status: "success" }),
      expect.objectContaining({ id: "skipped-live-send", status: "skipped" }),
    ]);
    expect(attempt.busEvents.some((event) => event.type === "trial.safe")).toBe(true);
  });

  it("records every blocked runtime ctx.runTool side effect even when code catches the errors", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const externalRunner = vi.fn(async () => ({ content: "sent external" }));
    const daemonRunner = vi.fn(async () => ({ content: "wrote daemon state" }));
    registerTool(
      {
        name: EXTERNAL_TOOL,
        description: "fixture external sender",
        input_schema: { type: "object", properties: {} },
      },
      externalRunner,
      "workflow-trial-test",
      { effect: networkDestructiveEffect() },
    );
    registerTool(
      {
        name: DAEMON_WRITE_TOOL,
        description: "fixture daemon writer",
        input_schema: { type: "object", properties: {} },
      },
      daemonRunner,
      "workflow-trial-test",
      { effect: daemonWriteEffect() },
    );

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "runtime-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "runtime-tool-fixture",
          steps: [
            {
              id: "code-attempts-tools",
              type: "code",
              run: async ({ runTool }) => {
                const errors: string[] = [];
                for (const tool of [EXTERNAL_TOOL, DAEMON_WRITE_TOOL]) {
                  try {
                    await runTool(tool, {});
                  } catch (err) {
                    errors.push(err instanceof Error ? err.message : String(err));
                  }
                }
                return { errors };
              },
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(attempt.stepStatuses).toContainEqual(
      expect.objectContaining({ id: "code-attempts-tools", status: "success" }),
    );
    expect(externalRunner).not.toHaveBeenCalled();
    expect(daemonRunner).not.toHaveBeenCalled();
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "code-attempts-tools",
        tool: EXTERNAL_TOOL,
      }),
      expect.objectContaining({
        stepId: "code-attempts-tools",
        tool: DAEMON_WRITE_TOOL,
      }),
    ]);
  });

  it("blocks KOTA-controlled agent process-env tools before adapter execution", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const processEnvRunner = vi.fn(async () => {
      process.env[PROCESS_ENV_KEY] = "mutated";
      return { content: "injected" };
    });
    registerTool(
      {
        name: PROCESS_ENV_TOOL,
        description: "fixture process env injector",
        input_schema: { type: "object", properties: {} },
      },
      processEnvRunner,
      "workflow-trial-test",
      { effect: credentialInjectionEffect() },
    );
    registerAgentHarness({
      name: PROCESS_ENV_AGENT_HARNESS,
      description: "trial process-env agent harness fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      async run(options: AgentHarnessRunOptions) {
        const decision = await options.canUseTool?.(PROCESS_ENV_TOOL, {}, {
          signal: options.abortController?.signal ?? new AbortController().signal,
          suggestions: [],
          toolUseId: "agent-process-env-tool-call",
        });
        if (!decision || decision.behavior === "allow") {
          const input = decision?.behavior === "allow" && decision.updatedInput
            ? decision.updatedInput
            : {};
          await executeTool(PROCESS_ENV_TOOL, input);
        }
        return {
          text: "agent finished",
          streamedText: "agent finished",
          turns: 1,
          isError: false,
        };
      },
    });

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "agent-process-env-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "agent-process-env-fixture",
          steps: [
            {
              id: "agent-attempts-process-env-tool",
              type: "agent",
              harness: PROCESS_ENV_AGENT_HARNESS,
              promptPath: "AGENTS.md",
              moduleRoot: trialProjectDir,
              model: "test-model",
              effort: "low",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(processEnvRunner).not.toHaveBeenCalled();
    expect(process.env[PROCESS_ENV_KEY]).toBeUndefined();
    expect(attempt.stepStatuses).toContainEqual(
      expect.objectContaining({ id: "agent-attempts-process-env-tool", status: "success" }),
    );
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "agent-attempts-process-env-tool",
        tool: PROCESS_ENV_TOOL,
        effect: expect.objectContaining({ scope: "process-env" }),
      }),
    ]);
  });

  it("blocks KOTA-controlled agent tool side effects before adapter execution", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    const externalRunner = vi.fn(async () => ({ content: "sent external" }));
    registerTool(
      {
        name: EXTERNAL_TOOL,
        description: "fixture external sender",
        input_schema: { type: "object", properties: {} },
      },
      externalRunner,
      "workflow-trial-test",
      { effect: networkDestructiveEffect() },
    );
    registerAgentHarness({
      name: AGENT_HARNESS,
      description: "trial agent harness fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      async run(options: AgentHarnessRunOptions) {
        const decision = await options.canUseTool?.(EXTERNAL_TOOL, {}, {
          signal: options.abortController?.signal ?? new AbortController().signal,
          suggestions: [],
          toolUseId: "agent-tool-call",
        });
        if (!decision || decision.behavior === "allow") {
          const input = decision?.behavior === "allow" && decision.updatedInput
            ? decision.updatedInput
            : {};
          await executeTool(EXTERNAL_TOOL, input);
        }
        return {
          text: "agent finished",
          streamedText: "agent finished",
          turns: 1,
          isError: false,
        };
      },
    });

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "agent-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir, {
          name: "agent-tool-fixture",
          steps: [
            {
              id: "agent-attempts-tool",
              type: "agent",
              harness: AGENT_HARNESS,
              promptPath: "AGENTS.md",
              moduleRoot: trialProjectDir,
              model: "test-model",
              effort: "low",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(attempt.status).toBe("blocked");
    expect(externalRunner).not.toHaveBeenCalled();
    expect(attempt.stepStatuses).toContainEqual(
      expect.objectContaining({ id: "agent-attempts-tool", status: "success" }),
    );
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "agent-attempts-tool",
        tool: EXTERNAL_TOOL,
      }),
    ]);
  });

  it("records repeat attempts and comparison variants in one summary", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);

    const summary = await runWorkflowTrial({
      sourceProjectDir: projectDir,
      workflowName: "trial-fixture",
      options: {
        payload: { marker: "primary" },
        repeat: 2,
        compareWorkflows: ["trial-fixture-b"],
        comparePayloads: [{ marker: "variant" }],
      },
      runtimeFactory: makeRuntimeFactory((trialProjectDir) => [
        makeDefinition(trialProjectDir),
        makeDefinition(trialProjectDir, { name: "trial-fixture-b" }),
      ]),
    });

    expect(summary.status).toBe("passed");
    expect(summary.repeat).toBe(2);
    expect(summary.comparison.workflows).toEqual(["trial-fixture-b"]);
    expect(summary.comparison.payloadVariants).toEqual([{ marker: "variant" }]);
    expect(summary.attempts).toHaveLength(6);
    const persisted = JSON.parse(
      readFileSync(join(projectDir, summary.reportDir, "summary.json"), "utf-8"),
    );
    expect(persisted.attempts.map((attempt: { payload: unknown }) => attempt.payload)).toEqual([
      { marker: "primary" },
      { marker: "primary" },
      { marker: "primary" },
      { marker: "primary" },
      { marker: "variant" },
      { marker: "variant" },
    ]);
    expect(JSON.stringify(persisted)).not.toContain("[Circular]");
    for (const attempt of summary.attempts) cleanup.push(attempt.trialProjectPath);
  });

  it("runs a local trial against the requested configured project id", async () => {
    const defaultProjectDir = makeProjectDir();
    const selectedProjectDir = makeProjectDir();
    cleanup.push(defaultProjectDir, selectedProjectDir);
    new ScopeRegistry({
      stateDir: join(defaultProjectDir, ".kota"),
      projects: [
        { projectDir: defaultProjectDir },
        { projectDir: selectedProjectDir },
      ],
    });
    writeProjectModule(selectedProjectDir, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      export default {
        name: "selected-trial-fixture-module",
        workflows: [{
          name: "selected-trial-fixture",
          definitionPath: "selected-trial-fixture-module",
          triggers: [{ event: "manual" }],
          steps: [{
            id: "write-selected-marker",
            type: "code",
            run: ({ projectDir, trigger }) => {
              mkdirSync(join(projectDir, "data"), { recursive: true });
              writeFileSync(join(projectDir, "data", "selected-marker.txt"), String(trigger.payload.marker), "utf-8");
            },
          }],
        }],
      };
    `);
    const selectedProjectId = deriveDirectoryScopeId(selectedProjectDir);

    const result = await runLocalWorkflowTrial(
      { cwd: defaultProjectDir } as ModuleContext,
      "selected-trial-fixture",
      { projectId: selectedProjectId, payload: { marker: "selected" } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.summary.projectId).toBe(selectedProjectId);
    expect(result.summary.sourceProjectPath).toBe(selectedProjectDir);
    expect(existsSync(join(defaultProjectDir, "data", "selected-marker.txt"))).toBe(false);
    expect(existsSync(join(selectedProjectDir, "data", "selected-marker.txt"))).toBe(false);
    const attempt = result.summary.attempts[0]!;
    cleanup.push(attempt.trialProjectPath);
    expect(readFileSync(join(attempt.trialProjectPath, "data", "selected-marker.txt"), "utf-8")).toBe("selected");
  });

  it("rejects an unknown requested project id before trial execution", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);

    const result = await runLocalWorkflowTrial(
      { cwd: projectDir } as ModuleContext,
      "trial-fixture",
      { projectId: "ghost-project" },
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_project",
      message: "Unknown project: ghost-project",
    });
  });

  it("CLI uses the daemon workflow client when the daemon handles trial execution", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const trial = vi.fn(async () => ({
      ok: true as const,
      summary: {
        runId: "trial-run",
        workflow: "trial-fixture",
        sourceProjectPath: "/project",
        reportDir: ".kota/runs/trial-run/workflow-trial",
        payload: { marker: "daemon" },
        repeat: 1,
        attempts: [],
        comparison: { workflows: [], payloadVariants: [] },
        passed: 1,
        failed: 0,
        blocked: 0,
        status: "passed" as const,
      },
    }));
    const program = makeTrialCliProgram({
      cwd: "/project",
      client: { workflow: { trial } },
    });

    await program.parseAsync([
      "node",
      "workflow",
      "trial",
      "trial-fixture",
      "--payload",
      "{\"marker\":\"daemon\"}",
    ]);

    expect(trial).toHaveBeenCalledWith("trial-fixture", {
      payload: { marker: "daemon" },
      repeat: 1,
    });
    expect(log).toHaveBeenCalledWith(
      [
        "Workflow trial trial-run: passed",
        "Report: .kota/runs/trial-run/workflow-trial/summary.json",
        "Attempts: 1 passed, 0 failed, 0 blocked",
      ].join("\n"),
    );
  });

  it("CLI falls back to the local isolated-project runner when the daemon is unavailable", async () => {
    const projectDir = makeProjectDir();
    cleanup.push(projectDir);
    writeProjectModule(projectDir, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      export default {
        name: "trial-fixture-module",
        workflows: [{
          name: "trial-fixture",
          definitionPath: "trial-fixture-module",
          triggers: [{ event: "manual" }],
          steps: [{
            id: "write-marker",
            type: "code",
            run: ({ projectDir, trigger }) => {
              mkdirSync(join(projectDir, "data"), { recursive: true });
              writeFileSync(join(projectDir, "data", "trial-marker.txt"), String(trigger.payload.marker), "utf-8");
            },
          }],
        }],
      };
    `);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const trial = vi.fn(async () => ({
      ok: false as const,
      reason: "daemon_required" as const,
      message: "daemon down",
    }));
    const program = makeTrialCliProgram({
      cwd: projectDir,
      client: { workflow: { trial } },
    });

    await program.parseAsync([
      "node",
      "workflow",
      "trial",
      "trial-fixture",
      "--payload",
      "{\"marker\":\"local\"}",
    ]);

    expect(trial).toHaveBeenCalledOnce();
    expect(existsSync(join(projectDir, "data", "trial-marker.txt"))).toBe(false);
    const output = String(log.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("Workflow trial ");
    expect(output).toContain(": passed");
    expect(output).toContain("Attempts: 1 passed, 0 failed, 0 blocked");
  });
});
