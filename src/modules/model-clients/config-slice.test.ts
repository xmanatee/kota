import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
import { failoverConfigSlice, modelProviderConfigSlice } from "./config-slice.js";

describe("model-clients config slices", () => {
  let tmpDir: string;

  beforeAll(() => {
    registerConfigSlice(modelProviderConfigSlice, "model-clients");
    registerConfigSlice(failoverConfigSlice, "model-clients");
  });

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kota-mc-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts modelProvider.type and baseUrl", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ modelProvider: { type: "ollama", baseUrl: "http://localhost:11434" } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.modelProvider?.type).toBe("ollama");
    expect(config.modelProvider?.baseUrl).toBe("http://localhost:11434");
  });

  it("drops modelProvider when neither type nor baseUrl is present", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ modelProvider: { apiKey: "secret" } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.modelProvider).toBeUndefined();
  });

  it("requires failover.provider to keep failover enabled", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ failover: { errorThreshold: 3 } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.failover).toBeUndefined();
  });

  it("accepts a full failover block", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({
        failover: {
          provider: "openai",
          model: "gpt-4o",
          errorThreshold: 3,
          windowMs: 30000,
          cooldownMs: 60000,
        },
      }),
    );
    const config = loadConfig(tmpDir);
    expect(config.failover?.provider).toBe("openai");
    expect(config.failover?.model).toBe("gpt-4o");
    expect(config.failover?.errorThreshold).toBe(3);
    expect(config.failover?.windowMs).toBe(30000);
    expect(config.failover?.cooldownMs).toBe(60000);
  });
});
