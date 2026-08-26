import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPreset } from "#core/model/preset.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions as validateWorkflowDefinitionsCore,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation.js";
import autonomyModule from "#modules/autonomy/index.js";
import {
  CLAUDE_AGENT_HARNESS_NAME,
  CLAUDE_AGENT_SDK_KNOWN_MODELS,
} from "#modules/claude-agent-harness/adapter.js";
// Side-effect import: registers the claude-agent-sdk harness so the step
// validator can resolve it when a test exercises `harnessOptions`.
import "#modules/antigravity-cli-agent-harness/index.js";
import "#modules/claude-agent-harness/index.js";
// Side-effect imports: register codex and gemini harnesses so per-harness
// validateModelId tests can verify those adapters accept arbitrary ids.
import "#modules/codex-agent-harness/index.js";
import "#modules/gemini-cli-agent-harness/index.js";
import "#modules/gemini-agent-harness/index.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { defineScopedModuleEvent } from "#core/events/scope.js";

function validateWorkflowDefinitions(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  scopeRoot = process.cwd(),
  options: WorkflowValidationOptions = {},
) {
  return validateWorkflowDefinitionsCore(definitions, scopeRoot, {
    defaultAgentHarness: "claude-agent-sdk",
    preset: getPreset("claude"),
    ...options,
  });
}

async function loadAutonomyWorkflowDefinitions(): Promise<RegisteredWorkflowDefinitionInput[]> {
  const workflows = autonomyModule.workflows;
  if (!workflows || typeof workflows !== "function") {
    throw new Error("autonomy module must expose workflows as a contribution factory");
  }
  return [...await workflows({} as never)] as RegisteredWorkflowDefinitionInput[];
}

function captureTerminalStderr(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  };
}

describe("workflow validation", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-workflow-validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder"),
      { recursive: true },
    );
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("validates a discovered workflow set", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]).toMatchObject({
      name: "builder",
      definitionPath: "test/builder.ts",
      enabled: true,
      triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
    });
  });

  it("accepts idleTimeoutMs on agent steps", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
              idleTimeoutMs: 60_000,
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.steps[0]).toMatchObject({ idleTimeoutMs: 60_000 });
  });

  it("rejects malformed idleTimeoutMs values", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
                idleTimeoutMs: 0,
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/idleTimeoutMs must be an integer >= 1/);
  });

  it("accepts idleTimeoutMs on parallel code children", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/fanout.ts", {
          repository: "read",
          name: "fanout",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "parallel-work",
              type: "parallel",
              steps: [
                {
                  id: "heartbeat",
                  type: "code",
                  idleTimeoutMs: 60_000,
                  run: () => ({ ok: true }),
                },
              ],
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.steps[0]).toMatchObject({
      type: "parallel",
      steps: [{ idleTimeoutMs: 60_000 }],
    });
  });

  it("rejects idleTimeoutMs on parallel groups", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/fanout.ts", {
            repository: "read",
            name: "fanout",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "parallel-work",
                type: "parallel",
                idleTimeoutMs: 60_000,
                steps: [
                  {
                    id: "heartbeat",
                    type: "code",
                    run: () => ({ ok: true }),
                  },
                ],
              } as RegisteredWorkflowDefinitionInput["steps"][number],
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/idleTimeoutMs is not supported on parallel groups/);
  });

  it("rejects malformed idleTimeoutMs values on parallel code children", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/fanout.ts", {
            repository: "read",
            name: "fanout",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "parallel-work",
                type: "parallel",
                steps: [
                  {
                    id: "heartbeat",
                    type: "code",
                    idleTimeoutMs: 0,
                    run: () => ({ ok: true }),
                  },
                ],
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/steps\[0\]\.steps\[0\]\.idleTimeoutMs must be an integer >= 1/);
  });

  it("rejects idleTimeoutMs on await-event steps", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/wait.ts", {
            repository: "read",
            name: "waiter",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "wait",
                type: "await-event",
                event: "owner.question.resolved",
                matchValue: "question-1",
                awaitTimeoutMs: 60_000,
                idleTimeoutMs: 1_000,
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/idleTimeoutMs is not supported on await-event steps/);
  });

  it("accepts trigger filters with multiple allowed values", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/improver.ts", {
          repository: "read",
          name: "improver",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "builder",
                status: ["success", "failed"],
              },
            },
          ],
          steps: [
            {
              id: "mark",
              type: "emit",
              event: "improver.done",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.triggers[0]?.filter).toEqual({
      workflow: "builder",
      status: ["success", "failed"],
    });
  });

  it("accepts default-scope placement only on schedule triggers", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/default-scope-schedule.ts", {
          repository: "read",
          name: "default-scope-schedule",
          triggers: [
            {
              event: "automation.default-scope.scheduled",
              schedule: "0 9 * * *",
              runOn: "default-scope",
              payload: { scopeId: "global" },
            },
          ],
          steps: [{ id: "mark", type: "code", run: () => ({ ok: true }) }],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.triggers[0]).toMatchObject({
      event: "automation.default-scope.scheduled",
      schedule: "0 9 * * *",
      runOn: "default-scope",
      payload: { scopeId: "global" },
    });

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/bad-run-on.ts", {
            repository: "read",
            name: "bad-run-on",
            triggers: [
              {
                event: "automation.event",
                runOn: "default-scope",
              },
            ],
            steps: [{ id: "mark", type: "code", run: () => ({ ok: true }) }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/runOn is only valid on schedule or interval triggers/);

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/bad-schedule-payload.ts", {
            repository: "read",
            name: "bad-schedule-payload",
            triggers: [
              {
                event: "automation.event",
                payload: { scopeId: "global" },
              },
            ],
            steps: [{ id: "mark", type: "code", run: () => ({ ok: true }) }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/payload is only valid on schedule or interval triggers/);
  });

  it("rejects trigger filters that reference undeclared module-event fields", () => {
    resetModuleEventRegistry();
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "fixture-module",
      defineDaemonWideModuleEvent<{ fixtureCount: number; passAtK: number }>(
        "fixture.module.event",
        ["fixtureCount", "passAtK"],
      ),
    );

    try {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/observer.ts", {
              repository: "read",
              name: "fixture-observer",
              triggers: [
                {
                  event: "fixture.module.event",
                  filter: { passAtK: 1, ghostField: "x" },
                },
              ],
              steps: [
                { id: "noop", type: "emit", event: "fixture.observer.done" },
              ],
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(/ghostField.*not filterable on event "fixture\.module\.event"/);
    } finally {
      resetModuleEventRegistry();
    }
  });

  it("validates nested trigger filters against module-event schema paths", () => {
    resetModuleEventRegistry();
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "fixture-module",
      defineDaemonWideModuleEvent<{
        actor: { id: string; trust: "trusted" | "blocked" };
      }>(
        "fixture.nested.event",
        ["actor"],
        {
          payloadSchema: {
            type: "object",
            properties: {
              actor: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  trust: { type: "string", enum: ["trusted", "blocked"] },
                },
              },
            },
          },
        },
      ),
    );

    try {
      const definitions = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/nested-observer.ts", {
            repository: "read",
            name: "fixture-nested-observer",
            triggers: [
              {
                event: "fixture.nested.event",
                filter: { "actor.trust": "trusted" },
              },
            ],
            steps: [
              { id: "noop", type: "emit", event: "fixture.nested.done" },
            ],
          }),
        ],
        scopeRoot,
      );
      expect(definitions[0]?.triggers[0]?.filter).toEqual({
        "actor.trust": "trusted",
      });
    } finally {
      resetModuleEventRegistry();
    }
  });

  it("rejects trigger schema versions that differ from the registered current version", () => {
    resetModuleEventRegistry();
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "fixture-module",
      defineDaemonWideModuleEvent<{ value: string }>(
        "fixture.versioned.event",
        ["value"],
        {
          schemaVersion: 2,
          payloadSchema: {
            type: "object",
            properties: { value: { type: "string" } },
          },
        },
      ),
    );

    try {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/version-observer.ts", {
              repository: "read",
              name: "fixture-version-observer",
              triggers: [
                {
                  event: "fixture.versioned.event",
                  schemaVersion: 1,
                  filter: { value: "ok" },
                },
              ],
              steps: [
                { id: "noop", type: "emit", event: "fixture.version.done" },
              ],
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(/schemaVersion 1.*currently declares schemaVersion 2/);
    } finally {
      resetModuleEventRegistry();
    }
  });

  it("accepts trigger filters that reference declared module-event fields", () => {
    resetModuleEventRegistry();
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "fixture-module",
      defineDaemonWideModuleEvent<{ fixtureCount: number; passAtK: number }>(
        "fixture.module.event.ok",
        ["fixtureCount", "passAtK"],
      ),
    );

    try {
      const definitions = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/observer.ts", {
            repository: "read",
            name: "fixture-observer-ok",
            triggers: [
              {
                event: "fixture.module.event.ok",
                filter: { passAtK: 1 },
              },
            ],
            steps: [
              { id: "noop", type: "emit", event: "fixture.observer.done" },
            ],
          }),
        ],
        scopeRoot,
      );
      expect(definitions[0]?.triggers[0]?.filter).toEqual({ passAtK: 1 });
    } finally {
      resetModuleEventRegistry();
    }
  });

  it("accepts scopeId filters for scope-scoped module events that declare scopeId", () => {
    resetModuleEventRegistry();
    const moduleEvents = initModuleEventRegistry();
    moduleEvents.register(
      "fixture-module",
      defineScopedModuleEvent<{ taskId: string }>(
        "fixture.scoped.event",
        ["taskId"],
      ),
    );

    try {
      const definitions = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/scoped-observer.ts", {
            repository: "read",
            name: "fixture-scoped-observer",
            triggers: [
              {
                event: "fixture.scoped.event",
                filter: { scopeId: "scope-a", taskId: "task-1" },
              },
            ],
            steps: [
              { id: "noop", type: "emit", event: "fixture.scoped.done" },
            ],
          }),
        ],
        scopeRoot,
      );
      expect(definitions[0]?.triggers[0]?.filter).toEqual({
        scopeId: "scope-a",
        taskId: "task-1",
      });
    } finally {
      resetModuleEventRegistry();
    }
  });

  it("accepts exposeOutputToAgent on workflow steps", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/explorer.ts", {
          repository: "read",
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "claim-task",
              type: "code",
              exposeOutputToAgent: true,
              run: () => ({ chosenTaskId: "task-demo" }),
            },
            {
              id: "build",
              type: "emit",
              event: "builder.done",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.steps[0]).toMatchObject({
      id: "claim-task",
      exposeOutputToAgent: true,
    });
  });

  it("accepts repair checks with severity and code validators", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
                repairLoop: {
                  maxRepairAttempts: 2,
                  checks: [
                    {
                      id: "queue-valid",
                      type: "code",
                      severity: "error",
                      run: () => ({ ok: true }),
                    },
                    {
                      id: "lint-warning",
                      severity: "warning",
                      tool: "shell",
                      input: { command: "npm run lint" },
                    },
                  ],
                },
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).not.toThrow();
  });

  it("preserves phase on repair checks through validation", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
              repairLoop: {
                checks: [
                  {
                    id: "build-output",
                    type: "code",
                    run: () => "OK",
                  },
                  {
                    id: "typecheck",
                    type: "code",
                    phase: 1,
                    run: () => "OK",
                  },
                  {
                    id: "critic",
                    type: "code",
                    phase: 2,
                    run: () => "OK",
                  },
                ],
              },
            },
          ],
        }),
      ],
      scopeRoot,
    );

    const step = definitions[0]?.steps[0] as { repairLoop?: { checks: Array<{ id: string; phase?: number }> } };
    const checks = step.repairLoop!.checks;
    expect(checks.find((c) => c.id === "build-output")?.phase).toBeUndefined();
    expect(checks.find((c) => c.id === "typecheck")?.phase).toBe(1);
    expect(checks.find((c) => c.id === "critic")?.phase).toBe(2);
  });

  it("rejects non-boolean exposeOutputToAgent values", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/explorer.ts", {
            repository: "read",
            name: "explorer",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "claim-task",
                type: "code",
                exposeOutputToAgent: "yes" as never,
                run: () => ({ chosenTaskId: "task-demo" }),
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("validates trigger queue mode", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/lossless-listener.ts", {
          repository: "read",
          name: "lossless-listener",
          triggers: [{ event: "work.completed", queueMode: "all" }],
          steps: [{ id: "run", type: "emit", event: "listener.done" }],
        }),
      ],
      scopeRoot,
    );
    expect(definitions[0]?.triggers[0]?.queueMode).toBe("all");

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/invalid-listener.ts", {
            repository: "read",
            name: "invalid-listener",
            triggers: [
              { event: "work.completed", queueMode: "oldest" as never },
            ],
            steps: [{ id: "run", type: "emit", event: "listener.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/queueMode must be "latest" or "all"/);
  });

  it("preserves timeoutMs on agent steps", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
              timeoutMs: 3 * 60 * 60 * 1000,
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.steps[0]).toMatchObject({
      id: "build",
      timeoutMs: 3 * 60 * 60 * 1000,
    });
  });

  it("requires trusted idle progress when active timeout is disabled", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/heartbeat.ts", {
          repository: "read",
          name: "heartbeat",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "work",
              type: "code",
              timeoutMs: null,
              idleTimeoutMs: 60_000,
              run: () => ({ ok: true }),
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.steps[0]).toMatchObject({
      timeoutMs: null,
      idleTimeoutMs: 60_000,
    });

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/heartbeat.ts", {
            repository: "read",
            name: "heartbeat",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "work",
                type: "code",
                timeoutMs: null,
                run: () => ({ ok: true }),
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/timeoutMs may be null only when idleTimeoutMs is set/);
  });

  it("rejects missing prompt files", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/missing.md",
                model: "claude-opus-4-7",
              effort: "xhigh",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow('promptPath does not exist: src/modules/autonomy/workflows/builder/missing.md');
  });

  it("rejects duplicate workflow names", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
          registerWorkflowDefinition("test/another-builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "again",
                type: "emit",
                event: "builder.done",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("requires restart steps to declare prior verification steps", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
              {
                id: "request-restart",
                type: "restart",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      'restart step "request-restart" must declare at least one required verification step',
    );
  });

  it("requires restart verification steps to be prior tool or code steps", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
              {
                id: "request-restart",
                type: "restart",
                requires: ["build"],
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      'restart step "request-restart" may only require tool, code, or parallel steps, got "agent" for "build"',
    );
  });

  it("requires restart to be the final workflow step", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "verify",
                type: "code",
                run: () => "ok",
              },
              {
                id: "request-restart",
                type: "restart",
                requires: ["verify"],
              },
              {
                id: "after",
                type: "emit",
                event: "builder.done",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow('restart step "request-restart" must be the final step');
  });

  it("rejects an unknown model id when the resolved harness declares a catalog", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "gpt-4-turbo",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      /workflow "builder" steps\[0\] resolved agent run contract is incompatible: unknown model "gpt-4-turbo" for harness "claude-agent-sdk"/,
    );
  });

  it("accepts every model id the active harness declares in its catalog", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    for (const model of CLAUDE_AGENT_SDK_KNOWN_MODELS) {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/builder.ts", {
              repository: "read",
              name: "builder",
              triggers: [{ event: "runtime.idle" }],
              steps: [
                {
                  id: "build",
                  type: "agent",
                  promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                  harness: CLAUDE_AGENT_HARNESS_NAME,
                  model,
                  effort: "xhigh" as const,
                  autonomyMode: "autonomous",
                },
              ],
            }),
          ],
          scopeRoot,
        ),
      ).not.toThrow();
    }
  });

  it("accepts a non-claude model id when the resolved harness declares no catalog (codex)", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                harness: "codex",
                model: "gpt-5.6-sol",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).not.toThrow();
  });

  it("rejects a passive Codex contract with its exact workflow and step path", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "passive-codex-fixture",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "review",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                harness: "codex",
                model: "gpt-5.6-sol",
                effort: "xhigh",
                autonomyMode: "passive",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      /test\/builder\.ts: workflow "passive-codex-fixture" steps\[0\] resolved agent run contract is incompatible: Agent harness "codex" cannot honor requested run option\(s\): autonomyMode="passive"\. autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA's passive contract\./,
    );
  });

  it("accepts a non-claude model id when the resolved harness declares no catalog (gemini)", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                harness: "gemini",
                model: "gemini-2.5-pro",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).not.toThrow();
  });

  it("accepts a non-claude model id when the resolved harness declares no catalog (gemini-cli)", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                harness: "gemini-cli",
                model: "gemini-2.5-pro",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).not.toThrow();
  });

  it("resolves a tier through config.modelTiers and stores the model on the validated step", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              tier: "capable",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    const step = definitions[0]?.steps[0];
    expect(step && "tier" in step ? step.tier : undefined).toBe("capable");
    expect(step && "model" in step ? step.model : undefined).toBe("claude-opus-4-7");
  });

  it("resolves a tier through caller-supplied modelTiers when the operator overrides the shipped default", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitionsCore(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              harness: "codex",
              tier: "capable",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      scopeRoot,
      {
        defaultAgentHarness: "claude-agent-sdk",
        modelTiers: { capable: "gpt-5.6-sol" },
      },
    );

    const step = definitions[0]?.steps[0];
    expect(step && "tier" in step ? step.tier : undefined).toBe("capable");
    expect(step && "model" in step ? step.model : undefined).toBe("gpt-5.6-sol");
  });

  it("resolves a tier through the active preset's tiers when no operator override is given", async () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const { getPreset } = await import("#core/model/preset.js");
    const codex = getPreset("codex");

    const definitions = validateWorkflowDefinitionsCore(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              harness: "codex",
              tier: "capable",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      scopeRoot,
      {
        defaultAgentHarness: "codex",
        preset: codex,
      },
    );

    const step = definitions[0]?.steps[0];
    expect(step && "tier" in step ? step.tier : undefined).toBe("capable");
    expect(step && "model" in step ? step.model : undefined).toBe(codex.tiers.capable);
  });

  it("operator modelTiers wins per-tier over the active preset's tiers", async () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const { getPreset } = await import("#core/model/preset.js");
    const codex = getPreset("codex");

    const definitions = validateWorkflowDefinitionsCore(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              harness: "codex",
              tier: "capable",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      scopeRoot,
      {
        defaultAgentHarness: "codex",
        preset: codex,
        modelTiers: { capable: "gpt-5.6-sol-custom" },
      },
    );

    const step = definitions[0]?.steps[0];
    expect(step && "model" in step ? step.model : undefined).toBe("gpt-5.6-sol-custom");
  });

  it("rejects an agent step that declares both model and tier", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                tier: "capable",
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/declares both "model" and "tier"/);
  });

  it("rejects an agent step that declares neither model nor tier", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                effort: "xhigh",
                autonomyMode: "autonomous",
              } as never,
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/must declare either "model" .*or "tier"/);
  });

  it("rejects an unknown tier value", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                tier: "ludicrous" as never,
                effort: "xhigh",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/tier must be one of fast, balanced, capable/);
  });

  it("rejects invalid autonomyMode in agent steps", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "bogus" as any,
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow("autonomyMode");
  });

  it("rejects agent steps that omit autonomyMode and have no workflow-level default", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      "autonomyMode is required — set autonomyMode on the step or declare defaultAutonomyMode on the workflow",
    );
  });

  it("rejects agent steps that omit harness and have no configured default harness", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitionsCore(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            defaultAutonomyMode: "autonomous",
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      "harness is required — set harness on the step or configure KotaConfig.defaultAgentHarness",
    );
  });

  it("applies workflow-level defaultAutonomyMode to agent steps that omit autonomyMode", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          defaultAutonomyMode: "autonomous",
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.defaultAutonomyMode).toBe("autonomous");
    const step = definitions[0]?.steps[0];
    expect(step && "autonomyMode" in step ? step.autonomyMode : undefined).toBe("autonomous");
  });

  it("allows per-step autonomyMode to override workflow defaultAutonomyMode", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          defaultAutonomyMode: "autonomous",
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "passive",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    const step = definitions[0]?.steps[0];
    expect(step && "autonomyMode" in step ? step.autonomyMode : undefined).toBe("passive");
  });

  it("rejects supervised autonomyMode when the resolved harness cannot honor it", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                model: "claude-opus-4-7",
                effort: "xhigh",
                autonomyMode: "supervised",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(
      /claude-agent-sdk.*autonomyMode="supervised".*no native route into KOTA's approval queue/,
    );
  });

  it("rejects invalid defaultAutonomyMode on workflow definitions", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            defaultAutonomyMode: "bogus" as never,
            steps: [{ id: "run", type: "emit", event: "builder.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow("defaultAutonomyMode must be one of passive, supervised, autonomous");
  });

  it("rejects agent steps without a model or tier field", () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            repository: "read",
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
                effort: "xhigh",
                autonomyMode: "autonomous",
              } as any,
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/steps\[0\] must declare either "model" .*or "tier"/);
  });

  it("exposes the expected autonomy workflows without pinning the full set", async () => {
    const definitions = validateWorkflowDefinitions(
      await loadAutonomyWorkflowDefinitions(),
      process.cwd(),
    );

    const names = definitions.map((definition) => definition.name);
    expect(names).toEqual(expect.arrayContaining([
      "inbox-sorter",
      "explorer",
      "builder",
      "improver",
      "attention-digest",
    ]));
  });

  it("accepts webhook trigger type", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/deploy.ts", {
          repository: "read",
          name: "deploy",
          triggers: [{ webhook: true }],
          steps: [{ id: "run", type: "emit", event: "deploy.done" }],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.triggers[0]).toEqual({ event: "webhook", cooldownMs: 0, webhook: true });
  });

  it("rejects webhook trigger combined with event", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/deploy.ts", {
            repository: "read",
            name: "deploy",
            triggers: [{ webhook: true, event: "runtime.idle" } as never],
            steps: [{ id: "run", type: "emit", event: "deploy.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("rejects a workflow.completed trigger with no workflow filter (self-trigger loop)", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/notifier.ts", {
            repository: "read",
            name: "notifier",
            triggers: [{ event: "workflow.completed" }],
            steps: [{ id: "notify", type: "emit", event: "notifier.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/infinite loop/);
  });

  it("rejects a workflow.completed trigger whose workflow filter includes its own name", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/notifier.ts", {
            repository: "read",
            name: "notifier",
            triggers: [
              {
                event: "workflow.completed",
                filter: { workflow: ["explorer", "notifier"] },
              },
            ],
            steps: [{ id: "notify", type: "emit", event: "notifier.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/infinite loop/);
  });

  it("accepts a workflow.completed trigger with a workflow filter that excludes itself", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/notifier.ts", {
            repository: "read",
            name: "notifier",
            triggers: [
              {
                event: "workflow.completed",
                filter: { workflow: ["explorer", "builder"] },
              },
            ],
            steps: [{ id: "notify", type: "emit", event: "notifier.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).not.toThrow();
  });

  it("accepts a valid trigger step", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/parent.ts", {
          repository: "read",
          name: "parent",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "notify",
              type: "trigger",
              workflow: "child",
              waitFor: "queued",
            },
          ],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0].steps[0]).toMatchObject({
      id: "notify",
      type: "trigger",
      workflow: "child",
      waitFor: "queued",
    });
  });

  it("defaults waitFor to queued when omitted", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/parent.ts", {
          repository: "read",
          name: "parent",
          triggers: [{ event: "runtime.idle" }],
          steps: [{ id: "notify", type: "trigger", workflow: "child" }],
        }),
      ],
      scopeRoot,
    );

    expect((definitions[0].steps[0] as { waitFor: string }).waitFor).toBe("queued");
  });

  it("rejects a trigger step that references the workflow's own name", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/recursive.ts", {
            repository: "read",
            name: "recursive",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "self-trigger", type: "trigger", workflow: "recursive" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/recursive call/);
  });

  it("rejects a trigger step with an invalid waitFor value", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/parent.ts", {
            repository: "read",
            name: "parent",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "notify",
                type: "trigger",
                workflow: "child",
                waitFor: "never" as "queued",
              },
            ],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(/waitFor/);
  });

  it("accepts a watch trigger with a string pattern", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/watcher.ts", {
          repository: "read",
          name: "watcher",
          triggers: [{ watch: "src/**/*.ts", debounceMs: 500 }],
          steps: [{ id: "run", type: "emit", event: "watcher.done" }],
        }),
      ],
      scopeRoot,
    );

    expect(definitions[0]?.triggers[0]).toMatchObject({
      event: "files.changed",
      cooldownMs: 0,
      watch: ["src/**/*.ts"],
      debounceMs: 500,
    });
  });

  it("accepts a watch trigger with an array of patterns", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/watcher.ts", {
          repository: "read",
          name: "watcher",
          triggers: [{ watch: ["src/**/*.ts", "test/**/*.ts"] }],
          steps: [{ id: "run", type: "emit", event: "watcher.done" }],
        }),
      ],
      scopeRoot,
    );

    const trigger = definitions[0]?.triggers[0];
    expect(trigger?.watch).toEqual(["src/**/*.ts", "test/**/*.ts"]);
    expect(trigger?.debounceMs).toBe(500); // default
  });

  it("rejects a watch trigger with debounceMs below minimum", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/watcher.ts", {
            repository: "read",
            name: "watcher",
            triggers: [{ watch: "src/**/*.ts", debounceMs: 100 }],
            steps: [{ id: "run", type: "emit", event: "watcher.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("rejects a watch trigger combined with event", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/watcher.ts", {
            repository: "read",
            name: "watcher",
            triggers: [{ watch: "src/**/*.ts", event: "runtime.idle" } as never],
            steps: [{ id: "run", type: "emit", event: "watcher.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("rejects a watch trigger with an empty pattern array", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/watcher.ts", {
            repository: "read",
            name: "watcher",
            triggers: [{ watch: [] as unknown as string }],
            steps: [{ id: "run", type: "emit", event: "watcher.done" }],
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("accepts webhookRateLimit with valid maxPerMinute", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/deploy.ts", {
          repository: "read",
          name: "deploy",
          triggers: [{ webhook: true }],
          steps: [{ id: "run", type: "emit", event: "deploy.done" }],
          webhookRateLimit: { maxPerMinute: 10 },
        }),
      ],
      scopeRoot,
    );
    expect(definitions[0]?.webhookRateLimit).toEqual({ maxPerMinute: 10 });
  });

  it("rejects webhookRateLimit with maxPerMinute < 1", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/deploy.ts", {
            repository: "read",
            name: "deploy",
            triggers: [{ webhook: true }],
            steps: [{ id: "run", type: "emit", event: "deploy.done" }],
            webhookRateLimit: { maxPerMinute: 0 },
          }),
        ],
        scopeRoot,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("omits webhookRateLimit when not specified", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/deploy.ts", {
          repository: "read",
          name: "deploy",
          triggers: [{ webhook: true }],
          steps: [{ id: "run", type: "emit", event: "deploy.done" }],
        }),
      ],
      scopeRoot,
    );
    expect(definitions[0]?.webhookRateLimit).toBeUndefined();
  });

  describe("notify block", () => {
    it("accepts the known flags only", () => {
      const definitions = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/deploy.ts", {
            repository: "read",
            name: "deploy",
            triggers: [{ webhook: true }],
            steps: [{ id: "run", type: "emit", event: "deploy.done" }],
            notify: { onFailure: false, onSuccess: true },
          }),
        ],
        scopeRoot,
      );
      expect(definitions[0]?.notify).toEqual({ onFailure: false, onSuccess: true });
    });

    it("rejects unknown keys (drift guard: catches reintroduced dead fields)", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/deploy.ts", {
              repository: "read",
              name: "deploy",
              triggers: [{ webhook: true }],
              steps: [{ id: "run", type: "emit", event: "deploy.done" }],
              notify: { onFailure: false, onCostAnomaly: true } as any,
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(/notify has unknown key\(s\): "onCostAnomaly"/);
    });

    it("rejects non-boolean values on known keys", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/deploy.ts", {
              repository: "read",
              name: "deploy",
              triggers: [{ webhook: true }],
              steps: [{ id: "run", type: "emit", event: "deploy.done" }],
              notify: { onFailure: "no" } as any,
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(/notify\.onFailure must be a boolean/);
    });

    it("rejects non-object notify values", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/deploy.ts", {
              repository: "read",
              name: "deploy",
              triggers: [{ webhook: true }],
              steps: [{ id: "run", type: "emit", event: "deploy.done" }],
              notify: [] as any,
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(/notify must be an object/);
    });
  });

  it("warns when a trigger step fires a child workflow with an outputSchema but waitFor omitted (default: queued)", () => {
    const stderr = captureTerminalStderr();
    try {
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/parent.ts", {
            repository: "read",
            name: "parent",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "launch", type: "trigger", workflow: "child" }],
          }),
          registerWorkflowDefinition("test/child.ts", {
            repository: "read",
            name: "child",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "run", type: "emit", event: "child.done" }],
            outputSchema: {
              type: "object",
              properties: { result: { type: "string" } },
              required: ["result"],
            },
          }),
        ],
        scopeRoot,
      );

      const output = stderr.output();
      expect(output).toContain("outputSchema");
      expect(output).toContain("launch");
      expect(output).toMatch(/waitFor.*"completed"/);
    } finally {
      stderr.restore();
    }
  });

  it("warns when a trigger step fires a child workflow with an outputSchema but waitFor: queued", () => {
    const stderr = captureTerminalStderr();
    try {
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/parent.ts", {
            repository: "read",
            name: "parent",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "launch", type: "trigger", workflow: "child", waitFor: "queued" }],
          }),
          registerWorkflowDefinition("test/child.ts", {
            repository: "read",
            name: "child",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "run", type: "emit", event: "child.done" }],
            outputSchema: {
              type: "object",
              properties: { result: { type: "string" } },
              required: ["result"],
            },
          }),
        ],
        scopeRoot,
      );

      const output = stderr.output();
      expect(output).toContain("outputSchema");
      expect(output).toContain("launch");
      expect(output).toMatch(/waitFor.*"completed"/);
    } finally {
      stderr.restore();
    }
  });

  it("does not warn when a trigger step fires a child workflow with an outputSchema and waitFor: completed", () => {
    const stderr = captureTerminalStderr();
    try {
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/parent.ts", {
            repository: "read",
            name: "parent",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "launch", type: "trigger", workflow: "child", waitFor: "completed" }],
          }),
          registerWorkflowDefinition("test/child.ts", {
            repository: "read",
            name: "child",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "run", type: "emit", event: "child.done" }],
            outputSchema: {
              type: "object",
              properties: { result: { type: "string" } },
            },
          }),
        ],
        scopeRoot,
      );

      expect(stderr.output()).not.toContain("outputSchema");
    } finally {
      stderr.restore();
    }
  });

  describe("approval steps", () => {
    it("accepts a minimal approval step", () => {
      const defs = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/wf.ts", {
            repository: "read",
            name: "my-workflow",
            triggers: [{ event: "runtime.idle" }],
            steps: [{ id: "confirm", type: "approval" }],
          }),
        ],
        scopeRoot,
      );
      expect(defs[0].steps[0]).toMatchObject({ id: "confirm", type: "approval" });
    });

    it("accepts an approval step with reason, timeoutMs, and defaultResolution", () => {
      const defs = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/wf.ts", {
            repository: "read",
            name: "my-workflow",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "confirm",
                type: "approval",
                reason: "Approve before deploying",
                timeoutMs: 3600_000,
                defaultResolution: "deny",
              },
            ],
          }),
        ],
        scopeRoot,
      );
      expect(defs[0].steps[0]).toMatchObject({
        id: "confirm",
        type: "approval",
        reason: "Approve before deploying",
        timeoutMs: 3600_000,
        defaultResolution: "deny",
      });
    });

    it("rejects an invalid defaultResolution", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/wf.ts", {
              repository: "read",
              name: "my-workflow",
              triggers: [{ event: "runtime.idle" }],
              steps: [
                {
                  id: "confirm",
                  type: "approval",
                  defaultResolution: "maybe" as never,
                },
              ],
            }),
          ],
          scopeRoot,
        ),
      ).toThrow('must be "deny" or "approve"');
    });

    it("rejects an approval step inside a branch arm", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/wf.ts", {
              repository: "read",
              name: "my-workflow",
              triggers: [{ event: "runtime.idle" }],
              steps: [
                {
                  id: "gate",
                  type: "branch",
                  condition: () => true,
                  ifTrue: [{ id: "confirm", type: "approval" }],
                },
              ],
            }),
          ],
          scopeRoot,
        ),
      ).toThrow("approval steps are not allowed inside branch arms");
    });
  });

  describe("agent step harnessOptions carve-out", () => {
    function makeAgentStepWithHarnessOptions(
      harnessOptions: Record<string, unknown> | undefined,
      overrides?: { harness?: string },
    ): RegisteredWorkflowDefinitionInput {
      writeFileSync(
        join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
        "Build.\n",
      );
      return registerWorkflowDefinition("test/builder.ts", {
        repository: "read",
        name: "builder",
        triggers: [{ event: "runtime.idle" }],
        steps: [
          {
            id: "build",
            type: "agent",
            promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            model: "claude-opus-4-7",
            effort: "xhigh",
            autonomyMode: "autonomous",
            ...(overrides?.harness !== undefined ? { harness: overrides.harness } : {}),
            ...(harnessOptions !== undefined ? { harnessOptions } : {}),
          },
        ],
      });
    }

    it("accepts a valid claude-agent-sdk harnessOptions block", () => {
      const defs = validateWorkflowDefinitions(
        [
          makeAgentStepWithHarnessOptions({
            "claude-agent-sdk": {
              permissionMode: "acceptEdits",
              settingSources: ["project", "local"],
            },
          }),
        ],
        scopeRoot,
      );
      const step = defs[0].steps[0] as { harnessOptions?: Record<string, unknown> };
      expect(step.harnessOptions).toEqual({
        "claude-agent-sdk": {
          permissionMode: "acceptEdits",
          settingSources: ["project", "local"],
        },
      });
    });

    it("normalizes an empty harnessOptions object to undefined", () => {
      const defs = validateWorkflowDefinitions(
        [makeAgentStepWithHarnessOptions({})],
        scopeRoot,
      );
      const step = defs[0].steps[0] as { harnessOptions?: Record<string, unknown> };
      expect(step.harnessOptions).toBeUndefined();
    });

    it("normalizes a claude-agent-sdk block with only unknown-undefined fields to undefined", () => {
      const defs = validateWorkflowDefinitions(
        [
          makeAgentStepWithHarnessOptions({
            "claude-agent-sdk": {},
          }),
        ],
        scopeRoot,
      );
      const step = defs[0].steps[0] as { harnessOptions?: Record<string, unknown> };
      expect(step.harnessOptions).toBeUndefined();
    });

    it("rejects harnessOptions keyed by a harness that does not match the step", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            makeAgentStepWithHarnessOptions({
              "openai-tools": { permissionMode: "acceptEdits" },
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(
        /harnessOptions key "openai-tools" does not match the step's resolved harness "claude-agent-sdk"/,
      );
    });

    it("rejects harnessOptions with more than one key", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            makeAgentStepWithHarnessOptions({
              "claude-agent-sdk": { permissionMode: "acceptEdits" },
              "openai-tools": {},
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(/harnessOptions must contain at most one key/);
    });

    it("rejects harnessOptions for an unknown harness", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            makeAgentStepWithHarnessOptions(
              { "made-up-harness": {} },
              { harness: "made-up-harness" },
            ),
          ],
          scopeRoot,
        ),
      ).toThrow(/harnessOptions references unknown harness "made-up-harness"/);
    });

    it("surfaces the harness validator error with step-path context", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            makeAgentStepWithHarnessOptions({
              "claude-agent-sdk": { permissionMode: "nope" },
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(
        /steps\[0\].harnessOptions\["claude-agent-sdk"\] rejected by harness validator: .*permissionMode must be one of/,
      );
    });

    it("rejects an unknown key inside the harness-specific block", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            makeAgentStepWithHarnessOptions({
              "claude-agent-sdk": { bogus: true },
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(
        /rejected by harness validator: unknown key\(s\): "bogus"/,
      );
    });

    it("rejects invalid settingSources entries", () => {
      expect(() =>
        validateWorkflowDefinitions(
          [
            makeAgentStepWithHarnessOptions({
              "claude-agent-sdk": { settingSources: ["project", "bogus"] },
            }),
          ],
          scopeRoot,
        ),
      ).toThrow(
        /settingSources entries must be one of project, local, user/,
      );
    });
  });
});
