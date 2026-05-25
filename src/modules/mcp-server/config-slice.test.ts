import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
import { mcpConfigSlice } from "./config-slice.js";

describe("mcp config slice", () => {
  let tmpDir: string;

  beforeAll(() => {
    registerConfigSlice(mcpConfigSlice, "mcp-server");
  });

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kota-mcp-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(tmpDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function loadTrustedConfig() {
    return loadConfig(tmpDir, { trustedProjects: [tmpDir] });
  }

  it("accepts mcp.sampling.enabled", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ mcp: { sampling: { enabled: true } } }),
    );
    const config = loadTrustedConfig();
    expect(config.mcp?.sampling?.enabled).toBe(true);
  });

  it("drops empty sampling block", () => {
    writeFileSync(
      join(tmpDir, ".kota", "config.json"),
      JSON.stringify({ mcp: { sampling: {} } }),
    );
    const config = loadTrustedConfig();
    expect(config.mcp).toBeUndefined();
  });
});
