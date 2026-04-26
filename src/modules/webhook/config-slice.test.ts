import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
import { webhookConfigSlice } from "./config-slice.js";

describe("webhook config slice", () => {
  let tmpDir: string;

  beforeAll(() => {
    registerConfigSlice(webhookConfigSlice, "webhook");
  });

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kota-webhook-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a per-workflow secret table", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { trigger: { secret: "abc" }, alarm: { secret: "xyz" } } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.webhooks?.trigger).toEqual({ secret: "abc" });
    expect(config.webhooks?.alarm).toEqual({ secret: "xyz" });
  });

  it("drops entries without a non-empty secret", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { good: { secret: "ok" }, bad: { secret: "" }, empty: {} } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.webhooks?.good).toEqual({ secret: "ok" });
    expect(config.webhooks?.bad).toBeUndefined();
    expect(config.webhooks?.empty).toBeUndefined();
  });

  it("merges secrets across layered configs", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { workflow_a: { secret: "a" } } }),
    );
    const config = loadConfig(tmpDir, { webhooks: { workflow_b: { secret: "b" } } });
    expect(config.webhooks?.workflow_a).toEqual({ secret: "a" });
    expect(config.webhooks?.workflow_b).toEqual({ secret: "b" });
  });
});
