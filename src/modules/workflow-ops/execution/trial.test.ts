import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const { FAKE_HOME } = vi.hoisted(() => {
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  return { FAKE_HOME: join(tmpdir(), `kota-workflow-trial-home-${Date.now()}`) };
});

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => FAKE_HOME };
});

import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { KotaConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId, ScopeRegistry } from "#core/daemon/scope-registry.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import {
  buildModuleCapabilityManifestProjection,
  clearModuleCapabilityManifestProjections,
  registerModuleCapabilityManifestProjection,
} from "#core/modules/module-manifest.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  credentialInjectionEffect,
  daemonWriteEffect,
  localWriteEffect,
  networkDestructiveEffect,
  readOnlyLocalEffect,
} from "#core/tools/effect.js";
import { deregisterTool, executeTool, registerTool } from "#core/tools/index.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { fileWriteTool, runFileWrite } from "#modules/filesystem/file-write.js";
import {
  createDefaultWorkflowTrialRuntimeFactory,
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

function trustProject(scopeRoot: string): void {
  const configDir = join(FAKE_HOME, ".kota");
  const configPath = join(configDir, "config.json");
  mkdirSync(configDir, { recursive: true });
  const trustedScopes = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf-8")) as { trustedScopes: string[] })
      .trustedScopes
    : [];
  writeFileSync(
    configPath,
    JSON.stringify({ trustedScopes: [...trustedScopes, scopeRoot] }),
  );
}

function makeScopeRoot(): string {
  const dir = join(
    tmpdir(),
    `kota-workflow-trial-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, "data", "tasks"), { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# Test Project\n", "utf-8");
  writeFileSync(join(dir, "data", "tasks", "AGENTS.md"), "# Tasks\n", "utf-8");
  trustProject(dir);
  return dir;
}

function writeProjectModule(scopeRoot: string, code: string): void {
  const moduleDir = join(scopeRoot, ".kota", "modules", "trial-fixture");
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
  scopeRoot: string,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    name: "trial-fixture",
    enabled: true,
    moduleRoot: scopeRoot,
    definitionPath: "fixture-workflow.ts",
    repository: "write",
    integration: { validationCommand: ["true"] },
    tags: [],
    triggers: [{ event: "manual", cooldownMs: 0 }],
    steps: [
      {
        id: "write-marker",
        type: "code",
        run: ({ workspaceRoot, trigger, emit }) => {
          mkdirSync(join(workspaceRoot, "data"), { recursive: true });
          writeFileSync(
            join(workspaceRoot, "data", "trial-marker.txt"),
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
  build: (scopeRoot: string) => WorkflowDefinition[],
): WorkflowTrialRuntimeFactory {
  return async (workspaceRoot) => ({
    config: {} as KotaConfig,
    workflows: build(workspaceRoot),
  });
}

describe("workflow trial execution", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    resetModuleEventRegistry();
    process.exitCode = undefined;
    deregisterTool(EXTERNAL_TOOL);
    deregisterTool(DAEMON_WRITE_TOOL);
    deregisterTool(UNSCOPED_LOCAL_WRITE_TOOL);
    deregisterTool(PROCESS_ENV_TOOL);
    deregisterTool("file_write");
    deregisterTool("shell");
    clearModuleCapabilityManifestProjections();
    delete process.env[PROCESS_ENV_KEY];
    rmSync(FAKE_HOME, { recursive: true, force: true });
    for (const dir of cleanup.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs in an isolated scope and reports changed files, steps, and bus events", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
    const trialFixtureEvent = defineDaemonWideModuleEvent<{ marker: string }>(
      "trial.fixture",
      ["marker"],
      {
        payloadSchema: {
          type: "object",
          properties: { marker: { type: "string" } },
          additionalProperties: false,
        },
      },
    );
    initModuleEventRegistry().register("workflow-trial-test", trialFixtureEvent);

    const summary = await runWorkflowTrial({
      sourceScopeRoot: workspaceRoot,
      workflowName: "trial-fixture",
      options: { payload: { marker: "isolated" } },
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot),
      ]),
    });

    expect(summary.status).toBe("passed");
    expect(summary.attempts).toHaveLength(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
    expect(existsSync(join(workspaceRoot, "data", "trial-marker.txt"))).toBe(false);
    expect(readFileSync(join(attempt.trialWorkspaceRoot, "data", "trial-marker.txt"), "utf-8")).toBe("isolated");
    expect(attempt.changedFiles).toContainEqual({
      path: "data/trial-marker.txt",
      change: "created",
    });
    expect(attempt.stepStatuses).toEqual([
      expect.objectContaining({ id: "write-marker", status: "success" }),
    ]);
    expect(attempt.busEvents.find((event) => event.type === trialFixtureEvent.name)).toEqual({
      type: trialFixtureEvent.name,
      schemaRef: { name: trialFixtureEvent.name, version: 1 },
      payload: { marker: "isolated" },
    });
    expect(existsSync(join(workspaceRoot, summary.reportDir, "summary.json"))).toBe(true);
  });

  it("scopes sensitive trial report payloads, bus events, and queued workflows", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
    const secret = "trial-secret-token";

    const summary = await runWorkflowTrial({
      sourceScopeRoot: workspaceRoot,
      workflowName: "sensitive-trial-fixture",
      options: {
        payload: { marker: "primary", token: secret },
      },
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "sensitive-trial-fixture",
          steps: [
            {
              id: "emit-and-queue",
              type: "code",
              run: async ({ trigger, emit, triggerWorkflow }) => {
                emit("trial.sensitive", {
                  token: trigger.payload.token,
                  rawPayload: { token: trigger.payload.token },
                });
                await triggerWorkflow(
                  "child-trial-fixture",
                  { marker: "child", token: trigger.payload.token },
                  "queued",
                  undefined,
                  "child-trial-fixture",
                );
                return { ok: true };
              },
            },
          ],
        }),
        makeDefinition(trialWorkspaceRoot, { name: "child-trial-fixture" }),
      ]),
    });

    expect(summary.status).toBe("passed");
    expect(summary.payload.token).toBe("[redacted]");
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
    expect(attempt.payload.token).toBe("[redacted]");
    expect(attempt.busEvents.find((event) => event.type === "trial.sensitive")?.payload)
      .toMatchObject({
        token: "[redacted]",
        rawPayload: {
          redacted: true,
          reason: "provider-payload",
        },
      });
    expect(attempt.queuedWorkflows[0]?.payload).toMatchObject({
      marker: "child",
      token: "[redacted]",
    });
    const persisted = readFileSync(join(workspaceRoot, summary.reportDir, "summary.json"), "utf-8");
    expect(persisted).not.toContain(secret);
  });

  it("roots local filesystem tool steps inside the isolated scope copy", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
    registerTool(fileWriteTool, runFileWrite, "workflow-trial-test", {
      effect: localWriteEffect(),
    });

    const summary = await runWorkflowTrial({
      sourceScopeRoot: workspaceRoot,
      workflowName: "tool-write-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "tool-write-fixture",
          steps: [
            {
              id: "write-marker-tool",
              type: "code",
              run: ({ runTool }) => runTool("file_write", {
                path: "data/tool-marker.txt",
                content: "trial tool write",
              }),
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("passed");
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
    expect(existsSync(join(workspaceRoot, "data", "tool-marker.txt"))).toBe(false);
    expect(readFileSync(join(attempt.trialWorkspaceRoot, "data", "tool-marker.txt"), "utf-8")).toBe("trial tool write");
    expect(attempt.changedFiles).toContainEqual({
      path: "data/tool-marker.txt",
      change: "created",
    });
  });

  it("blocks explicit external side-effect tool steps before execution", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "external-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "external-fixture",
          repository: "none",
          integration: undefined,
          steps: [{
            id: "send-live",
            type: "code",
            run: ({ runTool }) => runTool(EXTERNAL_TOOL, {}),
          }],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
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

  it("blocks tool side effects from the module manifest projection before registry metadata", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
    const externalRunner = vi.fn(async () => ({ content: "sent" }));
    registerTool(
      {
        name: EXTERNAL_TOOL,
        description: "fixture external sender",
        input_schema: { type: "object", properties: {} },
      },
      externalRunner,
      "workflow-trial-test",
      { effect: readOnlyLocalEffect() },
    );
    registerModuleCapabilityManifestProjection(
      buildModuleCapabilityManifestProjection(
        "workflow-trial-test",
        {
          schemaVersion: 1,
          capabilities: [
            {
              id: "workflow-trial-test.external-send",
              description: "Sends through the trial manifest fixture.",
              scope: "external",
              scopePolicyHooks: ["external-effects"],
            },
          ],
          dataClasses: [],
          simulation: {
            support: "external-effects-blocked",
            blockedReasons: ["Manifest fixture sends are blocked in trial mode."],
          },
        },
        {
          dependencies: [],
          tools: [
            {
              name: EXTERNAL_TOOL,
              description: "fixture external sender",
              effect: networkDestructiveEffect(),
            },
          ],
          effects: [],
          workflows: [],
          workflowTriggers: [],
          channels: [],
          skills: [],
          agents: [],
          commands: [],
          routes: [],
          controlRoutes: [],
          events: [],
          eventFlows: [],
          localClientNamespaces: [],
          hasDaemonClientFactory: false,
          setupRequirements: [],
          hasHealthCheck: false,
        },
      ),
    );

    const summary = await runWorkflowTrial({
      sourceScopeRoot: workspaceRoot,
      workflowName: "manifest-side-effect-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "manifest-side-effect-fixture",
          steps: [{ id: "send-live", type: "tool", tool: EXTERNAL_TOOL }],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
    expect(externalRunner).not.toHaveBeenCalled();
    expect(attempt.blockedExternalSideEffects).toEqual([
      expect.objectContaining({
        stepId: "send-live",
        tool: EXTERNAL_TOOL,
        effect: {
          kind: "destructive",
          scope: "external-network",
          openWorld: true,
        },
        manifest: {
          moduleName: "workflow-trial-test",
          effectId: `tool.${EXTERNAL_TOOL}`,
          categories: ["destructive", "external-write"],
          capabilityIds: ["workflow-trial-test.external-send"],
        },
      }),
    ]);
  });

  it("blocks daemon-state and unscoped local write tool steps before execution", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "blocked-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "blocked-tool-fixture",
          repository: "none",
          integration: undefined,
          steps: [
            {
              id: "write-daemon",
              type: "code",
              continueOnFailure: true,
              run: ({ runTool }) => runTool(DAEMON_WRITE_TOOL, {}),
            },
            {
              id: "write-local",
              type: "code",
              run: ({ runTool }) => runTool(UNSCOPED_LOCAL_WRITE_TOOL, {}),
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
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
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "process-env-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "process-env-fixture",
          steps: [{
            id: "inject-process-env",
            type: "code",
            run: ({ runTool }) => runTool(PROCESS_ENV_TOOL, {}),
          }],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
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
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "shell-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "shell-fixture",
          steps: [
            {
              id: "run-shell",
              type: "code",
              run: ({ runTool }) => runTool("shell", {
                command: "touch /tmp/kota-trial-shell-escape",
                cwd: ".",
              }),
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("failed");
    expect(summary.blocked).toBe(1);
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
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
        reason: expect.stringContaining("cannot root in the isolated scope"),
      }),
    ]);
  });

  it("executes the runtime and skips unreachable dangerous tool declarations", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "unreachable-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
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
              type: "code",
              when: () => false,
              run: ({ runTool }) => runTool(EXTERNAL_TOOL, {}),
            },
          ],
        }),
      ]),
    });

    expect(summary.status).toBe("passed");
    const attempt = summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
    expect(externalRunner).not.toHaveBeenCalled();
    expect(attempt.blockedExternalSideEffects).toEqual([]);
    expect(attempt.stepStatuses).toEqual([
      expect.objectContaining({ id: "safe-runtime-step", status: "success" }),
      expect.objectContaining({ id: "skipped-live-send", status: "skipped" }),
    ]);
    expect(attempt.busEvents.some((event) => event.type === "trial.safe")).toBe(true);
  });

  it("records every blocked runtime ctx.runTool side effect even when code catches the errors", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "runtime-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "runtime-tool-fixture",
          repository: "none",
          integration: undefined,
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
    cleanup.push(attempt.trialWorkspaceRoot);
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
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "agent-process-env-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "agent-process-env-fixture",
          steps: [
            {
              id: "agent-attempts-process-env-tool",
              type: "agent",
              harness: PROCESS_ENV_AGENT_HARNESS,
              promptPath: "AGENTS.md",
              moduleRoot: trialWorkspaceRoot,
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
    cleanup.push(attempt.trialWorkspaceRoot);
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
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
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
      sourceScopeRoot: workspaceRoot,
      workflowName: "agent-tool-fixture",
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot, {
          name: "agent-tool-fixture",
          steps: [
            {
              id: "agent-attempts-tool",
              type: "agent",
              harness: AGENT_HARNESS,
              promptPath: "AGENTS.md",
              moduleRoot: trialWorkspaceRoot,
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
    cleanup.push(attempt.trialWorkspaceRoot);
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
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);

    const summary = await runWorkflowTrial({
      sourceScopeRoot: workspaceRoot,
      workflowName: "trial-fixture",
      options: {
        payload: { marker: "primary" },
        repeat: 2,
        compareWorkflows: ["trial-fixture-b"],
        comparePayloads: [{ marker: "variant" }],
      },
      runtimeFactory: makeRuntimeFactory((trialWorkspaceRoot) => [
        makeDefinition(trialWorkspaceRoot),
        makeDefinition(trialWorkspaceRoot, { name: "trial-fixture-b" }),
      ]),
    });

    expect(summary.status).toBe("passed");
    expect(summary.repeat).toBe(2);
    expect(summary.comparison.workflows).toEqual(["trial-fixture-b"]);
    expect(summary.comparison.payloadVariants).toEqual([{ marker: "variant" }]);
    expect(summary.attempts).toHaveLength(6);
    const persisted = JSON.parse(
      readFileSync(join(workspaceRoot, summary.reportDir, "summary.json"), "utf-8"),
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
    for (const attempt of summary.attempts) cleanup.push(attempt.trialWorkspaceRoot);
  });

  it("runs a local trial against the requested configured scope id", async () => {
    const defaultScopeRoot = makeScopeRoot();
    const selectedScopeRoot = makeScopeRoot();
    cleanup.push(defaultScopeRoot, selectedScopeRoot);
    new ScopeRegistry({
      stateDir: join(defaultScopeRoot, ".kota"),
      scopes: [
        { scopeRoot: defaultScopeRoot },
        { scopeRoot: selectedScopeRoot },
      ],
    });
    writeProjectModule(selectedScopeRoot, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      export default {
        name: "selected-trial-fixture-module",
        workflows: [{
          name: "selected-trial-fixture",
          definitionPath: "selected-trial-fixture-module",
          repository: "write",
          integration: { validationCommand: ["true"] },
          triggers: [{ event: "manual" }],
          steps: [{
            id: "write-selected-marker",
            type: "code",
            run: ({ workspaceRoot, trigger }) => {
              mkdirSync(join(workspaceRoot, "data"), { recursive: true });
              writeFileSync(join(workspaceRoot, "data", "selected-marker.txt"), String(trigger.payload.marker), "utf-8");
            },
          }],
        }],
      };
    `);
    const selectedScopeId = deriveDirectoryScopeId(selectedScopeRoot);

    const result = await runLocalWorkflowTrial(
      { cwd: defaultScopeRoot } as ModuleContext,
      "selected-trial-fixture",
      { scopeId: selectedScopeId, payload: { marker: "selected" } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.summary.scopeId).toBe(selectedScopeId);
    expect(result.summary.sourceScopeRoot).toBe(realpathSync(selectedScopeRoot));
    expect(existsSync(join(defaultScopeRoot, "data", "selected-marker.txt"))).toBe(false);
    expect(existsSync(join(selectedScopeRoot, "data", "selected-marker.txt"))).toBe(false);
    const attempt = result.summary.attempts[0]!;
    cleanup.push(attempt.trialWorkspaceRoot);
    expect(readFileSync(join(attempt.trialWorkspaceRoot, "data", "selected-marker.txt"), "utf-8")).toBe("selected");
  });

  it("default runtime factory preserves workflow inputs and registered agent resolution", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
    writeProjectModule(workspaceRoot, `
      export default {
        name: "trial-agent-fixture-module",
        agents: [{
          name: "trial-agent",
          role: "Run trial agent steps.",
          promptPath: "AGENTS.md",
          model: "trial-agent-model",
          effort: "low",
          writeScope: [],
        }],
        workflows: [{
          name: "trial-agent-fixture",
          definitionPath: "trial-agent-fixture-module",
          defaultAutonomyMode: "autonomous",
          triggers: [{ event: "manual" }],
          steps: [{
            id: "agent",
            type: "agent",
            agentName: "trial-agent",
          }],
        }],
      };
    `);

    const runtime = await createDefaultWorkflowTrialRuntimeFactory()(workspaceRoot);
    try {
      const definition = runtime.workflows.find((d) => d.name === "trial-agent-fixture");
      expect(definition?.steps[0]).toMatchObject({
        id: "agent",
        type: "agent",
        agentName: "trial-agent",
      });
      expect(runtime.resolveAgentDef?.("trial-agent")).toMatchObject({
        name: "trial-agent",
        promptPath: "AGENTS.md",
        model: "trial-agent-model",
        effort: "low",
      });
    } finally {
      await runtime.unload?.();
    }
  });

  it("rejects an unknown requested scope id before trial execution", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);

    const result = await runLocalWorkflowTrial(
      { cwd: workspaceRoot } as ModuleContext,
      "trial-fixture",
      { scopeId: "ghost-scope" },
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_scope",
      message: "Unknown scope: ghost-scope",
    });
  });

  it("CLI uses the daemon workflow client when the daemon handles trial execution", async () => {
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      stdout.push(String(data));
      return true;
    });
    const trial = vi.fn(async () => ({
      ok: true as const,
      summary: {
        runId: "trial-run",
        workflow: "trial-fixture",
        sourceScopeRoot: "/project",
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

    try {
      await program.parseAsync([
        "node",
        "workflow",
        "trial",
        "trial-fixture",
        "--payload",
        "{\"marker\":\"daemon\"}",
      ]);
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(trial).toHaveBeenCalledWith("trial-fixture", {
      payload: { marker: "daemon" },
      repeat: 1,
    });
    const output = stdout.join("");
    expect(output).toContain("Workflow trial trial-run: passed");
    expect(output).toContain("Report: .kota/runs/trial-run/workflow-trial/summary.json");
    expect(output).toContain("Attempts: 1 passed, 0 failed, 0 blocked");
  });

  it("CLI falls back to the local isolated-project runner when the daemon is unavailable", async () => {
    const workspaceRoot = makeScopeRoot();
    cleanup.push(workspaceRoot);
    writeProjectModule(workspaceRoot, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      export default {
        name: "trial-fixture-module",
        workflows: [{
          name: "trial-fixture",
          definitionPath: "trial-fixture-module",
          repository: "write",
          integration: { validationCommand: ["true"] },
          triggers: [{ event: "manual" }],
          steps: [{
            id: "write-marker",
            type: "code",
            run: ({ workspaceRoot, trigger }) => {
              mkdirSync(join(workspaceRoot, "data"), { recursive: true });
              writeFileSync(join(workspaceRoot, "data", "trial-marker.txt"), String(trigger.payload.marker), "utf-8");
            },
          }],
        }],
      };
    `);
    const stdout: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      stdout.push(String(data));
      return true;
    });
    const trial = vi.fn(async () => ({
      ok: false as const,
      reason: "daemon_required" as const,
      message: "daemon down",
    }));
    const program = makeTrialCliProgram({
      cwd: workspaceRoot,
      client: { workflow: { trial } },
    });

    try {
      await program.parseAsync([
        "node",
        "workflow",
        "trial",
        "trial-fixture",
        "--payload",
        "{\"marker\":\"local\"}",
      ]);
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(trial).toHaveBeenCalledOnce();
    expect(existsSync(join(workspaceRoot, "data", "trial-marker.txt"))).toBe(false);
    const output = stdout.join("");
    expect(output).toContain("Workflow trial ");
    expect(output).toContain(": passed");
    expect(output).toContain("Attempts: 1 passed, 0 failed, 0 blocked");
  });
});
