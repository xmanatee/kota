import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkflowPauseSignal,
  hasPersistentDispatchPause,
  resolveWorkflowDispatchPause,
  writeOperatorPauseSignal,
} from "./dispatch-pause.js";
import { PAUSE_SIGNAL_FILE } from "./runtime-signals.js";

describe("workflow dispatch pause", () => {
  let projectDir: string;
  let pausePath: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-dispatch-pause-"));
    pausePath = join(projectDir, ".kota", PAUSE_SIGNAL_FILE);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("persists and clears an operator pause", () => {
    writeOperatorPauseSignal(projectDir);

    expect(hasPersistentDispatchPause(projectDir)).toBe(true);
    expect(JSON.parse(readFileSync(pausePath, "utf8"))).toMatchObject({
      kind: "operator",
    });
    expect(resolveWorkflowDispatchPause({ projectDir, runtimePaused: false })).toMatchObject({
      paused: true,
      kind: "operator",
      source: "signal",
    });

    clearWorkflowPauseSignal(projectDir);

    expect(existsSync(pausePath)).toBe(false);
    expect(resolveWorkflowDispatchPause({ projectDir, runtimePaused: false })).toEqual({
      paused: false,
      kind: "none",
    });
  });

  it("treats any existing pause marker as an operator signal", () => {
    writeOperatorPauseSignal(projectDir);
    writeFileSync(pausePath, "", "utf8");

    expect(resolveWorkflowDispatchPause({ projectDir, runtimePaused: false })).toMatchObject({
      paused: true,
      kind: "operator",
    });
  });

  it("reports an in-memory pause without creating persistent state", () => {
    expect(resolveWorkflowDispatchPause({ projectDir, runtimePaused: true })).toMatchObject({
      paused: true,
      kind: "runtime",
      source: "runtime",
    });
    expect(existsSync(pausePath)).toBe(false);
  });
});
