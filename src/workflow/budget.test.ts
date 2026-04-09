import {
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "../agent-sdk/index.js";
import { EventBus } from "../event-bus.js";
import { callTelegramApi } from "../modules/telegram/client.js";
import { WorkflowRunStore } from "./run-store.js";
import { WorkflowRuntime } from "./runtime.js";
import { registerWorkflowDefinition } from "./validation.js";

vi.mock("../agent-sdk/index.js", async () => {
  const actual = await vi.importActual("../agent-sdk/index.js");
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

vi.mock("../modules/telegram/client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);
const mockedCallTelegramApi = vi.mocked(callTelegramApi);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  totalCostUsd: number,
  completedAt: string,
  workflow = "builder",
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      workflow,
      definitionPath: `test/${workflow}.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: completedAt,
      completedAt,
      status: "success",
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [],
      totalCostUsd,
    }),
    "utf-8",
  );
}

describe("WorkflowRunStore.getDailySpendUsd", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns 0 when no runs exist", () => {
    const store = new WorkflowRunStore(projectDir);
    expect(store.getDailySpendUsd()).toBe(0);
  });

  it("sums costs of today's completed runs", () => {
    const store = new WorkflowRunStore(projectDir);
    const todayUtc = new Date().toISOString().slice(0, 10);
    writeRunMetadata(store.runsDir, "run-1", 0.25, `${todayUtc}T10:00:00.000Z`);
    writeRunMetadata(store.runsDir, "run-2", 0.10, `${todayUtc}T11:00:00.000Z`);
    expect(store.getDailySpendUsd()).toBeCloseTo(0.35);
  });

  it("excludes runs from a previous day", () => {
    const store = new WorkflowRunStore(projectDir);
    const todayUtc = new Date().toISOString().slice(0, 10);
    writeRunMetadata(store.runsDir, "run-today", 0.50, `${todayUtc}T08:00:00.000Z`);
    writeRunMetadata(store.runsDir, "run-yesterday", 1.00, "2020-01-01T10:00:00.000Z");
    expect(store.getDailySpendUsd()).toBeCloseTo(0.50);
  });

  it("filters spend to a specific workflow when name is provided", () => {
    const store = new WorkflowRunStore(projectDir);
    const todayUtc = new Date().toISOString().slice(0, 10);
    writeRunMetadata(store.runsDir, "run-builder", 0.30, `${todayUtc}T10:00:00.000Z`, "builder");
    writeRunMetadata(store.runsDir, "run-explorer", 0.20, `${todayUtc}T11:00:00.000Z`, "explorer");
    expect(store.getDailySpendUsd("builder")).toBeCloseTo(0.30);
    expect(store.getDailySpendUsd("explorer")).toBeCloseTo(0.20);
    expect(store.getDailySpendUsd()).toBeCloseTo(0.50);
  });

  it("returns 0 when named workflow has no completed runs today", () => {
    const store = new WorkflowRunStore(projectDir);
    const todayUtc = new Date().toISOString().slice(0, 10);
    writeRunMetadata(store.runsDir, "run-builder", 0.50, `${todayUtc}T10:00:00.000Z`, "builder");
    expect(store.getDailySpendUsd("explorer")).toBe(0);
  });

  it("excludes runs missing totalCostUsd", () => {
    const store = new WorkflowRunStore(projectDir);
    const todayUtc = new Date().toISOString().slice(0, 10);
    const dir = join(store.runsDir, "run-no-cost");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "metadata.json"),
      JSON.stringify({
        id: "run-no-cost",
        workflow: "builder",
        definitionPath: "test/builder.ts",
        trigger: { event: "runtime.idle", payload: {} },
        startedAt: `${todayUtc}T09:00:00.000Z`,
        completedAt: `${todayUtc}T09:01:00.000Z`,
        status: "success",
        durationMs: 1000,
        runDir: ".kota/runs/run-no-cost",
        steps: [],
      }),
      "utf-8",
    );
    expect(store.getDailySpendUsd()).toBe(0);
  });

  it("clears stale per-workflow pauses for workflows that no longer declare a budget", () => {
    const store = new WorkflowRunStore(projectDir);
    store.setWorkflowBudgetPauseUntil("explorer", "2999-01-01T00:00:00.000Z");
    store.setWorkflowBudgetPauseUntil("builder", "2999-01-01T00:00:00.000Z");

    const cleared = store.reconcileWorkflowBudgetPauses([
      registerWorkflowDefinition("test/explorer.ts", {
        name: "explorer",
        triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
        steps: [{ id: "inspect", type: "emit", event: "explorer.done" }],
      }),
      registerWorkflowDefinition("test/builder.ts", {
        name: "builder",
        dailyBudgetUsd: 5.0,
        triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
        steps: [{ id: "build", type: "emit", event: "builder.done" }],
      }),
    ]);

    expect(cleared).toEqual(["explorer"]);
    expect(store.readState().workflows.explorer?.budgetPausedUntil).toBeUndefined();
    expect(store.readState().workflows.builder?.budgetPausedUntil).toBe("2999-01-01T00:00:00.000Z");
  });
});

describe("BudgetGuard soft-limit warning", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-budget-warn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits warning when spend crosses the soft-limit threshold", async () => {
    const bus = new EventBus();
    const warningEvents: Record<string, unknown>[] = [];
    bus.on("workflow.budget.warning", (payload) => warningEvents.push(payload));

    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"), "Build.\n");
    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    // 0.9 spent of 1.0 budget = 90%, crosses 80% warnAt
    writeRunMetadata(store.runsDir, "prior-run", 0.9, `${todayUtc}T06:00:00.000Z`);

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0.01,
      subtype: "success",
      isError: false,
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      config: { dailyBudgetUsd: 1.0, budget: { warnAt: 0.8 } },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [{ id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(warningEvents.length).toBeGreaterThan(0);
    const evt = warningEvents[0];
    expect(evt.warnAt).toBe(0.8);
    expect(evt.budget).toBe(1.0);
    expect((evt.text as string)).toContain("80%");
  });

  it("does not emit warning when spend is below the soft-limit threshold", async () => {
    const bus = new EventBus();
    const warningEvents: Record<string, unknown>[] = [];
    bus.on("workflow.budget.warning", (payload) => warningEvents.push(payload));

    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    // 0.5 spent of 1.0 budget = 50%, below 80% warnAt
    writeRunMetadata(store.runsDir, "prior-run", 0.5, `${todayUtc}T06:00:00.000Z`);

    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"), "Build.\n");
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0.01,
      subtype: "success",
      isError: false,
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      config: { dailyBudgetUsd: 1.0, budget: { warnAt: 0.8 } },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [{ id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(warningEvents).toHaveLength(0);
  });

  it("emits soft-limit warning at most once per UTC day", async () => {
    const bus = new EventBus();
    const warningEvents: Record<string, unknown>[] = [];
    bus.on("workflow.budget.warning", (payload) => warningEvents.push(payload));

    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    writeRunMetadata(store.runsDir, "prior-run", 0.9, `${todayUtc}T06:00:00.000Z`);

    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"), "Build.\n");
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0.001,
      subtype: "success",
      isError: false,
    });

    // Run for long enough to trigger multiple dispatch cycles
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      config: { dailyBudgetUsd: 1.0, budget: { warnAt: 0.8 } },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [{ id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md" }],
        }),
      ],
    });

    runtime.start();
    await wait(120);
    await runtime.stop();

    expect(warningEvents).toHaveLength(1);
  });

  it("omitting budget.warnAt causes no warning notifications", async () => {
    const bus = new EventBus();
    const warningEvents: Record<string, unknown>[] = [];
    bus.on("workflow.budget.warning", (payload) => warningEvents.push(payload));

    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    writeRunMetadata(store.runsDir, "prior-run", 0.9, `${todayUtc}T06:00:00.000Z`);

    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"), "Build.\n");
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0.01,
      subtype: "success",
      isError: false,
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      config: { dailyBudgetUsd: 1.0 },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [{ id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(warningEvents).toHaveLength(0);
  });
});

describe("WorkflowRuntime budget enforcement", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-budget-rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), { recursive: true });
    mockedExecuteWithAgentSDK.mockReset();
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true, result: {} } as never);
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "test-chat";
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
  });

  it("pauses dispatch and emits workflow.budget.exceeded event when daily budget is reached", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build something useful.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: "sess-1",
      turns: 1,
      totalCostUsd: 0.5,
      subtype: "success",
      isError: false,
    });

    // Pre-seed spend: 1.0 already spent today (matches the budget exactly)
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    writeRunMetadata(store.runsDir, "prior-run", 1.0, `${todayUtc}T06:00:00.000Z`);

    const logs: string[] = [];
    const bus = new EventBus();
    const budgetEvents: Record<string, unknown>[] = [];
    bus.on("workflow.budget.exceeded", (payload) => budgetEvents.push(payload));

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      onLog: (msg) => logs.push(msg),
      config: { dailyBudgetUsd: 1.0 },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    // Already at 1.0 vs budget 1.0 — dispatch should be paused before first run
    const runsDir = join(projectDir, ".kota", "runs");
    const runIds = readdirSync(runsDir).filter((d) => d !== "prior-run");
    expect(runIds).toHaveLength(0);

    expect(logs.some((l) => l.includes("budget"))).toBe(true);
    expect(budgetEvents.length).toBeGreaterThan(0);
    const event = budgetEvents[0];
    expect(event.text as string).toContain("budget");
    expect(event.text as string).toContain("1.0000");
  });

  it("does not pause dispatch when spend is below budget", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build something useful.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0.1,
      subtype: "success",
      isError: false,
    });

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      config: { dailyBudgetUsd: 5.0 },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
  });

  it("resets budget pause automatically on UTC day rollover", async () => {
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });

    const started: string[] = [];
    const bus = new EventBus();
    bus.on("workflow.started", (payload) => {
      started.push(payload.workflow);
    });

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      config: { dailyBudgetUsd: 1.0 },
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
    });

    runtime.start();

    // Manually inject a past-day budget pause to simulate yesterday's budget being hit
    // biome-ignore lint/complexity/useLiteralKeys: bracket notation required to access private field in test
    runtime["budgetGuard"].pausedDate = "2020-01-01";

    // Today's spend is 0, so budget check passes; the stale budgetPausedDate is cleared
    await wait(60);
    await runtime.stop();

    expect(started.length).toBeGreaterThan(0);
    expect(started[0]).toBe("builder");
  });

  it("pauses a workflow for the rest of the UTC day when its per-workflow dailyBudgetUsd is reached", async () => {
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    writeRunMetadata(store.runsDir, "prior-builder", 2.0, `${todayUtc}T06:00:00.000Z`, "builder");
    writeRunMetadata(store.runsDir, "prior-explorer", 0.1, `${todayUtc}T06:00:00.000Z`, "explorer");

    const logs: string[] = [];
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      onLog: (msg) => logs.push(msg),
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          dailyBudgetUsd: 2.0,
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [{ id: "run", type: "emit", event: "builder.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    // builder budget exhausted — no new runs should have been created
    const runsDir = join(projectDir, ".kota", "runs");
    const newRunIds = readdirSync(runsDir).filter(
      (d) => d !== "prior-builder" && d !== "prior-explorer",
    );
    expect(newRunIds).toHaveLength(0);
    const budgetLogs = logs.filter((l) => l.includes('workflow "builder"') && l.includes("budget"));
    expect(budgetLogs).toHaveLength(1);
    expect(budgetLogs[0]).toContain("Pausing it until");
    expect(mockedExecuteWithAgentSDK).not.toHaveBeenCalled();

    const pausedUntil = store.getWorkflowBudgetPauseUntil("builder");
    expect(pausedUntil).toBeTruthy();
  });

  it("clears an expired per-workflow budget pause automatically", () => {
    const store = new WorkflowRunStore(projectDir);
    store.setWorkflowBudgetPauseUntil("builder", "2020-01-01T00:00:00.000Z");

    expect(store.getWorkflowBudgetPauseUntil("builder")).toBeNull();
    expect(store.readState().workflows.builder?.budgetPausedUntil).toBeUndefined();
  });

  it("clears stale workflow budget pauses during runtime startup when current definitions are uncapped", async () => {
    const store = new WorkflowRunStore(projectDir);
    store.setWorkflowBudgetPauseUntil("explorer", "2999-01-01T00:00:00.000Z");

    const logs: string[] = [];
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      onLog: (message) => logs.push(message),
      workflows: [
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [{ id: "run", type: "emit", event: "explorer.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(30);
    await runtime.stop();

    expect(store.readState().workflows.explorer?.budgetPausedUntil).toBeUndefined();
    expect(
      logs.some((message) => message.includes("Cleared stale workflow budget pause(s): explorer")),
    ).toBe(true);
  });

  it("allows a workflow to run when only another workflow's budget is exhausted", async () => {
    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "explorer"), { recursive: true });
    writeFileSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"), "Build.\n");
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    const todayUtc = new Date().toISOString().slice(0, 10);
    const store = new WorkflowRunStore(projectDir);
    // builder exhausted
    writeRunMetadata(store.runsDir, "prior-builder", 5.0, `${todayUtc}T06:00:00.000Z`, "builder");

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 0.1,
      subtype: "success",
      isError: false,
    });

    const started: string[] = [];
    const bus = new EventBus();
    bus.on("workflow.started", (p) => started.push(p.workflow));

    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 10,
      onLog: (msg) => void msg,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          dailyBudgetUsd: 5.0,
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            { id: "build", type: "agent", promptPath: "src/modules/autonomy/workflows/builder/prompt.md" },
          ],
        }),
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [{ id: "run", type: "emit", event: "explorer.done" }],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    // explorer (no budget) should have run; builder (budget exhausted) should not
    expect(started).toContain("explorer");
    expect(started).not.toContain("builder");
  });

  it("behaves normally when no dailyBudgetUsd is configured", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      totalCostUsd: 100.0,
      subtype: "success",
      isError: false,
    });

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 10,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
    });

    runtime.start();
    await wait(80);
    await runtime.stop();

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalled();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });
});
