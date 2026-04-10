import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusEvents } from "#core/events/event-bus.js";
import { EventBus } from "#core/events/event-bus.js";
import { subscribeWorkflowFailureAlert } from "./failure-alert.js";

function makePayload(
  status: "success" | "failed" | "interrupted",
  overrides: Partial<{
    workflow: string;
    runId: string;
    durationMs: number;
    runDir: string;
  }> = {},
) {
  return {
    workflow: overrides.workflow ?? "builder",
    runId: overrides.runId ?? "run-abc",
    status,
    triggerEvent: "runtime.idle",
    durationMs: overrides.durationMs ?? 5000,
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    runDir: overrides.runDir ?? ".kota/runs/run-abc",
  };
}

describe("subscribeWorkflowFailureAlert", () => {
  let projectDir: string;
  let bus: EventBus;
  let unsubscribe: () => void;
  let emittedAlerts: BusEvents["workflow.failure.alert"][];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    bus = new EventBus();
    emittedAlerts = [];
    bus.on("workflow.failure.alert", (payload) => {
      emittedAlerts.push(payload);
    });
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir);
  });

  afterEach(() => {
    unsubscribe();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits workflow.failure.alert on failed workflow", () => {
    const payload = makePayload("failed");
    bus.emit("workflow.completed", payload);
    expect(emittedAlerts).toHaveLength(1);
    const alert = emittedAlerts[0];
    expect(alert.status).toBe("failed");
    expect(alert.workflow).toBe("builder");
    expect(alert.runId).toBe("run-abc");
    expect(alert.text).toContain("failed");
    expect(alert.text).toContain("builder");
    expect(alert.text).toContain("run-abc");
    expect(alert.text).toContain("5.0s");
  });

  it("emits workflow.failure.alert on interrupted workflow", () => {
    bus.emit("workflow.completed", makePayload("interrupted"));
    expect(emittedAlerts).toHaveLength(1);
    expect(emittedAlerts[0].status).toBe("interrupted");
    expect(emittedAlerts[0].text).toContain("interrupted");
  });

  it("does not emit alert on success", () => {
    bus.emit("workflow.completed", makePayload("success"));
    expect(emittedAlerts).toHaveLength(0);
  });

  it("includes error summary when error.txt exists", () => {
    const runDir = ".kota/runs/run-with-error";
    const runDirPath = join(projectDir, runDir);
    mkdirSync(runDirPath, { recursive: true });
    writeFileSync(join(runDirPath, "error.txt"), "Agent exceeded token budget");
    bus.emit("workflow.completed", makePayload("failed", { runDir }));
    expect(emittedAlerts[0].errorSummary).toBe("Agent exceeded token budget");
    expect(emittedAlerts[0].text).toContain("Agent exceeded token budget");
  });

  it("omits error line when error.txt is absent", () => {
    bus.emit("workflow.completed", makePayload("failed"));
    expect(emittedAlerts[0].errorSummary).toBe("");
    expect(emittedAlerts[0].text).not.toContain("Error:");
  });

  it("truncates long error summaries", () => {
    const runDir = ".kota/runs/run-long-error";
    const runDirPath = join(projectDir, runDir);
    mkdirSync(runDirPath, { recursive: true });
    writeFileSync(join(runDirPath, "error.txt"), "x".repeat(500));
    bus.emit("workflow.completed", makePayload("failed", { runDir }));
    expect(emittedAlerts[0].text).toContain("...");
    expect(emittedAlerts[0].text.length).toBeLessThan(600);
  });

  it("unsubscribes correctly and stops receiving events", () => {
    unsubscribe();
    bus.emit("workflow.completed", makePayload("failed"));
    expect(emittedAlerts).toHaveLength(0);
  });
});

describe("subscribeWorkflowFailureAlert — cooldown", () => {
  let projectDir: string;
  let bus: EventBus;
  let unsubscribe: () => void;
  let emittedAlerts: BusEvents["workflow.failure.alert"][];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    bus = new EventBus();
    emittedAlerts = [];
    bus.on("workflow.failure.alert", (payload) => {
      emittedAlerts.push(payload);
    });
  });

  afterEach(() => {
    unsubscribe?.();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("fires on first failure when cooldown is set", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, { alertCooldownMs: 60_000 });
    bus.emit("workflow.completed", makePayload("failed"));
    expect(emittedAlerts).toHaveLength(1);
  });

  it("suppresses second failure within cooldown window", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, { alertCooldownMs: 60_000 });
    bus.emit("workflow.completed", makePayload("failed", { runId: "run-1" }));
    bus.emit("workflow.completed", makePayload("failed", { runId: "run-2" }));
    expect(emittedAlerts).toHaveLength(1);
    expect(emittedAlerts[0].runId).toBe("run-1");
  });

  it("fires again after cooldown window expires", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, { alertCooldownMs: 1 });
    bus.emit("workflow.completed", makePayload("failed", { runId: "run-1" }));
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        bus.emit("workflow.completed", makePayload("failed", { runId: "run-2" }));
        expect(emittedAlerts).toHaveLength(2);
        expect(emittedAlerts[1].runId).toBe("run-2");
        resolve();
      }, 5);
    });
  });

  it("cooldown is per-workflow — suppresses builder but not explorer", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, { alertCooldownMs: 60_000 });
    bus.emit("workflow.completed", makePayload("failed", { workflow: "builder", runId: "b-1" }));
    bus.emit("workflow.completed", makePayload("failed", { workflow: "builder", runId: "b-2" }));
    bus.emit("workflow.completed", makePayload("failed", { workflow: "explorer", runId: "e-1" }));
    expect(emittedAlerts).toHaveLength(2);
    expect(emittedAlerts[0].workflow).toBe("builder");
    expect(emittedAlerts[1].workflow).toBe("explorer");
  });

  it("zero cooldown fires on every failure", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, { alertCooldownMs: 0 });
    bus.emit("workflow.completed", makePayload("failed", { runId: "run-1" }));
    bus.emit("workflow.completed", makePayload("failed", { runId: "run-2" }));
    bus.emit("workflow.completed", makePayload("failed", { runId: "run-3" }));
    expect(emittedAlerts).toHaveLength(3);
  });
});

describe("subscribeWorkflowFailureAlert — notify config", () => {
  let projectDir: string;
  let bus: EventBus;
  let unsubscribe: () => void;
  let emittedAlerts: BusEvents["workflow.failure.alert"][];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    bus = new EventBus();
    emittedAlerts = [];
    bus.on("workflow.failure.alert", (payload) => {
      emittedAlerts.push(payload);
    });
  });

  afterEach(() => {
    unsubscribe?.();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("suppresses failure alert when onFailure is false for the workflow", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, {
      getWorkflowNotify: (name) => name === "builder" ? { onFailure: false } : undefined,
    });
    bus.emit("workflow.completed", makePayload("failed", { workflow: "builder" }));
    expect(emittedAlerts).toHaveLength(0);
  });

  it("does not suppress failure alert for unaffected workflows", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, {
      getWorkflowNotify: (name) => name === "builder" ? { onFailure: false } : undefined,
    });
    bus.emit("workflow.completed", makePayload("failed", { workflow: "explorer" }));
    expect(emittedAlerts).toHaveLength(1);
    expect(emittedAlerts[0].workflow).toBe("explorer");
  });

  it("emits failure alert when onFailure is true (explicit default)", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, {
      getWorkflowNotify: () => ({ onFailure: true }),
    });
    bus.emit("workflow.completed", makePayload("failed"));
    expect(emittedAlerts).toHaveLength(1);
  });

  it("emits failure alert when notify config is undefined (default behavior)", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, {
      getWorkflowNotify: () => undefined,
    });
    bus.emit("workflow.completed", makePayload("failed"));
    expect(emittedAlerts).toHaveLength(1);
  });

  it("suppresses for one workflow but not another in the same run", () => {
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, undefined, {
      getWorkflowNotify: (name) => name === "housekeeping" ? { onFailure: false } : undefined,
    });
    bus.emit("workflow.completed", makePayload("failed", { workflow: "housekeeping", runId: "h-1" }));
    bus.emit("workflow.completed", makePayload("failed", { workflow: "builder", runId: "b-1" }));
    expect(emittedAlerts).toHaveLength(1);
    expect(emittedAlerts[0].workflow).toBe("builder");
  });
});
