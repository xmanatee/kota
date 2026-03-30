import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusEvents } from "../event-bus.js";
import { EventBus } from "../event-bus.js";
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
    definitionPath: "src/workflows/builder/workflow.ts",
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
