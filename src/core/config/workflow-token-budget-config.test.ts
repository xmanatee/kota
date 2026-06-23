import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type KotaConfig, loadConfig } from "./config.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-config-token-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("workflow token budget config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function trustedProject(overrides: Partial<KotaConfig> = {}): Partial<KotaConfig> {
    return { ...overrides, trustedProjects: [tmpDir] };
  }

  it("loads a workflow agent token budget from trusted config and drops invalid values", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        workflow: {
          agentTokenBudget: { maxTotalTokens: 50_000 },
        },
      }),
    );

    const config = loadConfig(
      tmpDir,
      trustedProject({
        workflow: {
          agentTokenBudget: { maxTotalTokens: 0 },
        },
      }),
    );

    expect(config.workflow?.agentTokenBudget).toEqual({ maxTotalTokens: 50_000 });
  });
});
