import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
import { resolveWorkflowConcurrency } from "#core/workflow/concurrency.js";
import { schedulerConfigSlice } from "./config-slice.js";

describe("scheduler config slice", () => {
  let tmpDir: string;

  beforeAll(() => {
    registerConfigSlice(schedulerConfigSlice, "scheduler");
  });

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kota-scheduler-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function loadTrustedConfig(overrides = {}) {
    const globalConfigPath = join(tmpDir, "machine-config.json");
    writeFileSync(globalConfigPath, JSON.stringify({ trustedProjects: [tmpDir] }));
    return loadConfig(tmpDir, overrides, { globalConfigPath });
  }

  it("resolves a valid configured override", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { concurrency: 8 } }),
    );
    const config = loadTrustedConfig();
    expect(resolveWorkflowConcurrency(config.scheduler)).toBe(8);
  });

  it("rejects invalid concurrency without discarding valid scheduler behavior", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({
        scheduler: { concurrency: 0, dispatchWindow: { start: "09:00", end: "18:00" } },
      }),
    );
    const config = loadTrustedConfig();
    expect(config.scheduler?.concurrency).toBeUndefined();
    expect(config.scheduler?.dispatchWindow).toBeDefined();
  });
});
