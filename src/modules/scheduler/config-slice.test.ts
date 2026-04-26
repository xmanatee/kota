import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
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

  it("loads agentConcurrency and codeConcurrency", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 2, codeConcurrency: 8 } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.scheduler?.agentConcurrency).toBe(2);
    expect(config.scheduler?.codeConcurrency).toBe(8);
  });

  it("rejects non-positive or non-integer agentConcurrency", () => {
    for (const val of [0, -1, 1.5, "two"]) {
      writeFileSync(
        join(tmpDir, ".kota", "config.json"),
        JSON.stringify({ scheduler: { agentConcurrency: val } }),
      );
      const config = loadConfig(tmpDir);
      expect(config.scheduler?.agentConcurrency).toBeUndefined();
    }
  });

  it("rejects invalid codeConcurrency but preserves other slice fields", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({
        scheduler: { codeConcurrency: 0, dispatchWindow: { start: "09:00", end: "18:00" } },
      }),
    );
    const config = loadConfig(tmpDir);
    expect(config.scheduler?.codeConcurrency).toBeUndefined();
    expect(config.scheduler?.dispatchWindow).toBeDefined();
  });

  it("merges scheduler fields from layered configs", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 1 } }),
    );
    const config = loadConfig(tmpDir, { scheduler: { codeConcurrency: 4 } });
    expect(config.scheduler?.agentConcurrency).toBe(1);
    expect(config.scheduler?.codeConcurrency).toBe(4);
  });
});
