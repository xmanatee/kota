import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { defineScopedModuleEvent } from "#core/events/scope.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
  type WorkflowValidationOptions,
} from "./validation.js";

// Workflow authors submit definitions to the public validator. These cases
// observe normalized contracts and boundary rejection in the owner portfolio.
const code = { id: "work", type: "code", run: () => "ok" } as const;
const agent = {
  id: "agent",
  type: "agent",
  promptPath: "prompt.md",
  model: "fixture-model",
  effort: "high",
  autonomyMode: "autonomous",
};
function definition(overrides: Partial<RegisteredWorkflowDefinitionInput> = {}) {
  return registerWorkflowDefinition("fixture.ts", {
    repository: "read",
    name: "fixture",
    triggers: [{ event: "manual" }],
    steps: [code],
    ...overrides,
  });
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kota-validation-"));
  writeFileSync(join(root, "prompt.md"), "Review.\n");
  resetModuleEventRegistry();
});
afterEach(() => {
  resetModuleEventRegistry();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function validate(
  overrides: Record<string, unknown> = {},
  options: WorkflowValidationOptions = {
    defaultAgentHarness: "fixture",
    defaultAgentEffort: "high",
  },
) {
  // Intentionally malformed declarations cross the public decoding boundary here.
  return validateWorkflowDefinitions(
    [definition(overrides as Partial<RegisteredWorkflowDefinitionInput>)],
    root,
    options,
  )[0];
}

describe("definition admission", () => {
  it("registers source identity and normalizes a discovered definition", () => {
    expect(validate()).toMatchObject({
      name: "fixture",
      definitionPath: "fixture.ts",
      enabled: true,
      repository: "read",
      triggers: [{ event: "manual", cooldownMs: 0 }],
    });
  });

  it("rejects malformed cron before schedule registration within a process deadline", () => {
    // A same-thread test timeout cannot interrupt synchronous parser expansion.
    // Exercise the author-facing boundary in a killable process instead.
    const transcript = execFileSync(process.execPath, [
      "--conditions=source", "--import", "tsx", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./src/core/workflow/validation.ts";
      import { getNextCronTime } from "./src/core/workflow/cron.ts";
      import { ScheduleTriggerManager } from "./src/core/workflow/schedule-triggers.ts";
      const manager = new ScheduleTriggerManager(
        () => ({ completedRuns: 0, workflows: {} }), () => false,
        () => assert.fail("invalid schedule fired"), () => {},
      );
      const invalid = [
        ["*/0 * * * *", "minute", "positive safe integer"],
        ["*/-1 * * * *", "minute", "invalid syntax"],
        ["1-5/0 * * * *", "minute", "positive safe integer"],
        ["60 * * * *", "minute", "0-59"],
        ["0-60 * * * *", "minute", "0-59"],
        ["-1 * * * *", "minute", "invalid syntax"],
        ["0 24 * * *", "hour", "0-23"],
        ["0 0 0 * *", "day-of-month", "1-31"],
        ["0 0 32 * *", "day-of-month", "1-31"],
        ["0 0 * 0 *", "month", "1-12"],
        ["0 0 * 13 *", "month", "1-12"],
        ["0 0 * * 8", "day-of-week", "0-7"],
        ["5-1 * * * *", "minute", "range start"],
        ["1/2/3 * * * *", "minute", "invalid syntax"],
        ["1,,2 * * * *", "minute", "invalid syntax"],
        [",1 * * * *", "minute", "invalid syntax"],
        ["1, * * * *", "minute", "invalid syntax"],
        ["1- * * * *", "minute", "invalid syntax"],
        ["1-2-3 * * * *", "minute", "invalid syntax"],
        ["*/ * * * *", "minute", "invalid syntax"],
        ["1.5 * * * *", "minute", "invalid syntax"],
        ["1e1 * * * *", "minute", "invalid syntax"],
        ["abc * * * *", "minute", "invalid syntax"],
        ["9007199254740992 * * * *", "minute", "safe integers"],
        ["0-9007199254740992 * * * *", "minute", "safe integers"],
        ["*/9007199254740992 * * * *", "minute", "positive safe integer"],
        ["*/" + "9".repeat(400) + " * * * *", "minute", "positive safe integer"],
        ["* * * *", "5 fields", "got 4"],
        ["* * * * * *", "5 fields", "got 6"],
      ];
      try {
        for (const [schedule, field, reason] of invalid) {
          const started = performance.now();
          let diagnostic;
          try {
            const definitions = validateWorkflowDefinitions([registerWorkflowDefinition("author/cron.ts", {
              name: "cron-probe", repository: "none", triggers: [{ schedule }],
              steps: [{ id: "work", type: "code", run: () => "ok" }],
            })]);
            manager.setup(definitions);
          } catch (error) {
            assert.equal(error.name, "WorkflowDefinitionError");
            diagnostic = error.message;
          }
          assert.ok(diagnostic, "accepted " + schedule);
          for (const expected of ["author/cron.ts", "triggers[0].schedule", field, reason]) {
            assert.ok(diagnostic.includes(expected), diagnostic);
          }
          assert.equal(manager.nextScheduledAt().size, 0);
          assert.equal(getNextCronTime(schedule, new Date("2026-01-01T00:00:00Z")), null);
          console.log(JSON.stringify({ schedule, diagnostic, timers: 0, elapsedMs: performance.now() - started }));
        }
      } finally {
        manager.clearAll();
      }
      `,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
    expect(transcript.trim().split("\n")).toHaveLength(29);
  });

  it("rejects duplicate workflow identities and reports both contributors", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [definition(), { ...definition(), definitionPath: "other.ts" }],
        root,
      ),
    ).toThrow(/fixture\.ts.*other\.ts|other\.ts.*fixture\.ts/);
  });

  it.each([
    ["unknown notification flag", { notify: { onCostAnomaly: true } }, /notify has unknown key/],
    [
      "non-boolean notification",
      { notify: { onFailure: "no" } },
      /notify\.onFailure must be a boolean/,
    ],
    ["non-object notification", { notify: [] }, /notify must be an object/],
    ["zero webhook rate", { webhookRateLimit: { maxPerMinute: 0 } }, /maxPerMinute/],
    ["invalid default autonomy", { defaultAutonomyMode: "bogus" }, /defaultAutonomyMode/],
  ])("rejects %s", (_label, input, error) => {
    expect(() => validate(input)).toThrow(error);
  });

  it("propagates notification and webhook rate policy without inventing defaults", () => {
    expect(
      validate({
        notify: { onFailure: false, onSuccess: true },
        webhookRateLimit: { maxPerMinute: 10 },
      }),
    ).toMatchObject({
      notify: { onFailure: false, onSuccess: true },
      webhookRateLimit: { maxPerMinute: 10 },
    });
    expect(validate().webhookRateLimit).toBeUndefined();
  });
});

describe("trigger admission", () => {
  it.each([
    [{ webhook: true }, { event: "webhook", cooldownMs: 0, webhook: true }],
    [
      { watch: "src/**/*.ts", debounceMs: 750 },
      { event: "files.changed", watch: ["src/**/*.ts"], debounceMs: 750 },
    ],
    [
      { watch: ["src/**/*.ts", "test/**/*.ts"] },
      { watch: ["src/**/*.ts", "test/**/*.ts"], debounceMs: 500 },
    ],
    [
      { event: "manual", queueMode: "all", cooldownMs: 30_000 },
      { event: "manual", queueMode: "all", cooldownMs: 30_000 },
    ],
    [
      {
        event: "workflow.completed",
        filter: { workflow: ["builder", "explorer"], status: ["success", "failed"] },
      },
      { filter: { workflow: ["builder", "explorer"], status: ["success", "failed"] } },
    ],
    [
      {
        event: "scheduled",
        schedule: "0 9 * * *",
        runOn: "default-scope",
        payload: { scopeId: "global" },
      },
      { schedule: "0 9 * * *", runOn: "default-scope", payload: { scopeId: "global" } },
    ],
  ])("normalizes trigger %j", (input, expected) => {
    expect(validate({ triggers: [input] }).triggers[0]).toMatchObject(expected);
  });

  it.each([
    ["webhook with event", { webhook: true, event: "manual" }, /webhook/],
    ["watch with event", { watch: "src/**", event: "manual" }, /watch/],
    ["empty watch patterns", { watch: [] }, /watch/],
    ["short debounce", { watch: "src/**", debounceMs: 100 }, /debounceMs/],
    ["unknown queue mode", { event: "manual", queueMode: "oldest" }, /queueMode/],
    ["event-only placement", { event: "manual", runOn: "default-scope" }, /runOn is only valid/],
    [
      "event-only payload",
      { event: "manual", payload: { scopeId: "global" } },
      /payload is only valid/,
    ],
    ["unfiltered completion", { event: "workflow.completed" }, /infinite loop/],
    [
      "self completion",
      { event: "workflow.completed", filter: { workflow: ["builder", "fixture"] } },
      /infinite loop/,
    ],
  ])("rejects %s", (_label, input, error) => {
    expect(() => validate({ triggers: [input] })).toThrow(error);
  });

  it("checks declared, nested, versioned, and canonical scope event filters", () => {
    const events = initModuleEventRegistry();
    events.register(
      "producer",
      defineDaemonWideModuleEvent<{ actor: { trust: string }; count: number }>(
        "fixture.result",
        ["actor", "count"],
        {
          schemaVersion: 2,
          payloadSchema: {
            type: "object",
            properties: {
              actor: { type: "object", properties: { trust: { type: "string" } } },
              count: { type: "number" },
            },
          },
        },
      ),
    );
    events.register(
      "producer",
      defineScopedModuleEvent<{ taskId: string }>("fixture.scoped", ["taskId"]),
    );
    const filter = { "actor.trust": "trusted", count: 1 };
    expect(
      validate({ triggers: [{ event: "fixture.result", filter }] }).triggers[0].filter,
    ).toEqual(filter);
    expect(() =>
      validate({ triggers: [{ event: "fixture.result", filter: { ghost: "x" } }] }),
    ).toThrow(/ghost.*not filterable/);
    expect(() =>
      validate({ triggers: [{ event: "fixture.result", filter: { "actor.ghost": "x" } }] }),
    ).toThrow(/actor.ghost.*not filterable/);
    expect(() => validate({ triggers: [{ event: "fixture.result", schemaVersion: 1 }] })).toThrow(
      /schemaVersion 1.*schemaVersion 2/,
    );
    const scoped = { scopeId: "scope-a", taskId: "task-1" };
    expect(
      validate({ triggers: [{ event: "fixture.scoped", filter: scoped }] }).triggers[0].filter,
    ).toEqual(scoped);
  });
});

describe("step admission", () => {
  it.each([
    [
      { ...agent, idleTimeoutMs: 60_000, timeoutMs: 10_800_000 },
      { idleTimeoutMs: 60_000, timeoutMs: 10_800_000 },
    ],
    [
      { ...code, timeoutMs: null, idleTimeoutMs: 60_000, exposeOutputToAgent: true },
      { timeoutMs: null, idleTimeoutMs: 60_000, exposeOutputToAgent: true },
    ],
    [
      { id: "fanout", type: "parallel", steps: [{ ...code, idleTimeoutMs: 60_000 }] },
      { steps: [{ idleTimeoutMs: 60_000 }] },
    ],
    [
      { id: "confirm", type: "approval" },
      { id: "confirm", type: "approval" },
    ],
    [
      {
        id: "confirm",
        type: "approval",
        reason: "Deploy",
        timeoutMs: 3600_000,
        defaultResolution: "deny",
      },
      { reason: "Deploy", timeoutMs: 3600_000, defaultResolution: "deny" },
    ],
    [
      { id: "launch", type: "trigger", workflow: "child" },
      { workflow: "child", waitFor: "queued" },
    ],
    [
      { id: "launch", type: "trigger", workflow: "child", waitFor: "queued" },
      { waitFor: "queued" },
    ],
  ])("propagates step contract %j", (input, expected) => {
    expect(validate({ steps: [input] }).steps[0]).toMatchObject(expected);
  });

  it.each([
    [
      "invalid agent idle timeout",
      { ...agent, idleTimeoutMs: 0 },
      /idleTimeoutMs must be an integer >= 1/,
    ],
    [
      "parallel group idle timeout",
      { id: "fanout", type: "parallel", idleTimeoutMs: 60_000, steps: [code] },
      /idleTimeoutMs is not supported on parallel/,
    ],
    [
      "nested idle timeout",
      { id: "fanout", type: "parallel", steps: [{ ...code, idleTimeoutMs: 0 }] },
      /steps\[0\]\.steps\[0\]\.idleTimeoutMs/,
    ],
    [
      "await-event idle timeout",
      {
        id: "wait",
        type: "await-event",
        event: "owner.question.resolved",
        matchValue: "q",
        awaitTimeoutMs: 60_000,
        idleTimeoutMs: 1000,
      },
      /idleTimeoutMs is not supported on await-event/,
    ],
    [
      "unbounded code without idle progress",
      { ...code, timeoutMs: null },
      /timeoutMs may be null only when idleTimeoutMs is set/,
    ],
    ["non-boolean agent exposure", { ...code, exposeOutputToAgent: "yes" }, /exposeOutputToAgent/],
    [
      "missing prompt",
      { ...agent, promptPath: "missing.md" },
      /promptPath does not exist: missing.md/,
    ],
    ["model and tier together", { ...agent, tier: "capable" }, /declares both "model" and "tier"/],
    [
      "missing model and tier",
      { ...agent, model: undefined },
      /must declare either "model" .*or "tier"/,
    ],
    ["unknown tier", { ...agent, model: undefined, tier: "ludicrous" }, /tier must be one of/],
    ["invalid autonomy", { ...agent, autonomyMode: "bogus" }, /autonomyMode/],
    ["missing autonomy", { ...agent, autonomyMode: undefined }, /autonomyMode is required/],
    [
      "invalid approval resolution",
      { id: "confirm", type: "approval", defaultResolution: "maybe" },
      /must be "deny" or "approve"/,
    ],
    [
      "approval nested in branch",
      {
        id: "gate",
        type: "branch",
        condition: () => true,
        ifTrue: [{ id: "confirm", type: "approval" }],
      },
      /approval steps are not allowed inside branch arms/,
    ],
    ["recursive child", { id: "launch", type: "trigger", workflow: "fixture" }, /recursive call/],
    [
      "invalid child wait",
      { id: "launch", type: "trigger", workflow: "child", waitFor: "never" },
      /waitFor/,
    ],
  ])("rejects %s", (_label, input, error) => {
    expect(() => validate({ steps: [input] })).toThrow(error);
  });

  it("requires a resolved harness and propagates workflow autonomy unless overridden", () => {
    expect(() => validate({ steps: [agent] }, {})).toThrow(/harness is required/);
    const defaults = { defaultAutonomyMode: "autonomous" as const };
    expect(validate({ ...defaults, steps: [{ ...agent, autonomyMode: undefined }] })).toMatchObject(
      {
        defaultAutonomyMode: "autonomous",
        steps: [{ autonomyMode: "autonomous" }],
      },
    );
    expect(
      validate({ ...defaults, steps: [{ ...agent, autonomyMode: "passive" }] }).steps[0],
    ).toMatchObject({ autonomyMode: "passive" });
  });

  it("retains repair validator behavior, severity, and phase", () => {
    const check = () => ({ ok: true });
    const repairLoop = {
      maxRepairAttempts: 2,
      checks: [
        { id: "output", type: "code", severity: "error", run: check },
        {
          id: "lint",
          severity: "warning",
          phase: 1,
          tool: "shell",
          input: { command: "pnpm lint" },
        },
        { id: "critic", type: "code", phase: 2, run: check },
      ],
    };
    expect(validate({ steps: [{ ...agent, repairLoop }] }).steps[0]).toMatchObject({ repairLoop });
  });

  it.each([
    undefined,
    "queued",
    "completed",
  ] as const)("diagnoses unconsumed child output with waitFor=%s", (waitFor) => {
    const chunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const definitions = validateWorkflowDefinitions(
      [
        definition({ steps: [{ id: "launch", type: "trigger", workflow: "child", waitFor }] }),
        definition({
          name: "child",
          outputSchema: { type: "object", properties: { result: { type: "string" } } },
        }),
      ],
      root,
    );
    expect(definitions[0].steps[0]).toMatchObject({ waitFor: waitFor ?? "queued" });
    if (waitFor === "completed") expect(chunks.join("")).not.toContain("outputSchema");
    else expect(chunks.join("")).toMatch(/launch.*outputSchema.*waitFor.*"completed"/s);
  });

  it.each([
    [[{ id: "restart", type: "restart" }], /must declare at least one required verification step/],
    [
      [
        { id: "emit", type: "emit", event: "done" },
        { id: "restart", type: "restart", requires: ["emit"] },
      ],
      /may only require tool, code, or parallel steps/,
    ],
    [
      [
        code,
        { id: "restart", type: "restart", requires: ["work"] },
        { id: "after", type: "code", run: () => "late" },
      ],
      /must be the final step/,
    ],
  ])("rejects an unsafe restart sequence %j", (steps, error) => {
    expect(() => validate({ steps })).toThrow(error);
  });
});
