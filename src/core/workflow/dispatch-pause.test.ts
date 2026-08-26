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
  let scopeRoot: string;
  let pausePath: string;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-dispatch-pause-"));
    pausePath = join(scopeRoot, ".kota", PAUSE_SIGNAL_FILE);
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("persists and clears an operator pause", () => {
    writeOperatorPauseSignal(scopeRoot);

    expect(hasPersistentDispatchPause(scopeRoot)).toBe(true);
    expect(JSON.parse(readFileSync(pausePath, "utf8"))).toMatchObject({
      kind: "operator",
    });
    expect(resolveWorkflowDispatchPause({ scopeRoot, runtimePaused: false })).toMatchObject({
      paused: true,
      kind: "operator",
      source: "signal",
    });

    clearWorkflowPauseSignal(scopeRoot);

    expect(existsSync(pausePath)).toBe(false);
    expect(resolveWorkflowDispatchPause({ scopeRoot, runtimePaused: false })).toEqual({
      paused: false,
      kind: "none",
    });
  });

  it("treats any existing pause marker as an operator signal", () => {
    writeOperatorPauseSignal(scopeRoot);
    writeFileSync(pausePath, "", "utf8");

    expect(resolveWorkflowDispatchPause({ scopeRoot, runtimePaused: false })).toMatchObject({
      paused: true,
      kind: "operator",
    });
  });

  it("reports an in-memory pause without creating persistent state", () => {
    expect(resolveWorkflowDispatchPause({ scopeRoot, runtimePaused: true })).toMatchObject({
      paused: true,
      kind: "runtime",
      source: "runtime",
    });
    expect(existsSync(pausePath)).toBe(false);
  });
});
