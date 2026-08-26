import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readStoredWorkflowRuntimeState,
  setStoredDispatchPaused,
} from "./stored-runtime-state.js";

describe("stored workflow runtime state", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("does not create a database while reading missing offline state", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-offline-state-"));
    roots.push(projectDir);
    const stateDir = join(projectDir, "explicit-daemon-state");

    expect(readStoredWorkflowRuntimeState(projectDir, stateDir)).toMatchObject({
      activeRuns: [],
      pendingRuns: [],
      operatorPaused: false,
    });
    expect(existsSync(stateDir)).toBe(false);
  });

  it("does not create a database for offline mutation", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-offline-control-"));
    roots.push(projectDir);
    const stateDir = join(projectDir, "explicit-daemon-state");

    expect(() => setStoredDispatchPaused(projectDir, stateDir, true)).toThrow(
      /no canonical workflow state/i,
    );
    expect(existsSync(stateDir)).toBe(false);
  });
});
