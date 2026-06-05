import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { PAUSE_SIGNAL_FILE, WorkflowRuntime } from "./runtime.js";

describe("WorkflowRuntime dispatch pause persistence", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-runtime-pause-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function pausePath(): string {
    return join(projectDir, ".kota", PAUSE_SIGNAL_FILE);
  }

  it("writes and removes the persisted operator pause marker", () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });

    runtime.setDispatchPaused(true, "persistent");

    expect(existsSync(pausePath())).toBe(true);
    expect(runtime.isDispatchPaused()).toBe(true);

    runtime.setDispatchPaused(false, "persistent");

    expect(existsSync(pausePath())).toBe(false);
    expect(runtime.isDispatchPaused()).toBe(false);
  });

  it("keeps temporary runtime pauses separate from the persisted marker", () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(pausePath(), "");

    runtime.setDispatchPaused(false);

    expect(existsSync(pausePath())).toBe(true);
    expect(runtime.isDispatchPaused()).toBe(true);
  });
});
