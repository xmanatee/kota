import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
import { tracingConfigSlice } from "./config-slice.js";

describe("tracing config slice", () => {
  let tmpDir: string;

  beforeAll(() => {
    registerConfigSlice(tracingConfigSlice, "tracing");
  });

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kota-tracing-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function loadTrustedConfig() {
    return loadConfig(tmpDir, { trustedProjects: [tmpDir] });
  }

  it("requires endpoint to enable tracing", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ tracing: { samplingRate: 0.5 } }),
    );
    const config = loadTrustedConfig();
    expect(config.tracing).toBeUndefined();
  });

  it("accepts a full tracing block", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({
        tracing: {
          endpoint: "http://localhost:4318/v1/traces",
          metricsEndpoint: "http://localhost:4318/v1/metrics",
          logsEndpoint: "http://localhost:4318/v1/logs",
          metricsExportIntervalMs: 5000,
          samplingRate: 0.25,
          serviceName: "kota-test",
        },
      }),
    );
    const config = loadTrustedConfig();
    expect(config.tracing?.endpoint).toBe("http://localhost:4318/v1/traces");
    expect(config.tracing?.metricsEndpoint).toBe("http://localhost:4318/v1/metrics");
    expect(config.tracing?.logsEndpoint).toBe("http://localhost:4318/v1/logs");
    expect(config.tracing?.metricsExportIntervalMs).toBe(5000);
    expect(config.tracing?.samplingRate).toBe(0.25);
    expect(config.tracing?.serviceName).toBe("kota-test");
  });

  it("rejects samplingRate outside 0..1", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ tracing: { endpoint: "http://x", samplingRate: 2 } }),
    );
    const config = loadTrustedConfig();
    expect(config.tracing?.endpoint).toBe("http://x");
    expect(config.tracing?.samplingRate).toBeUndefined();
  });
});
