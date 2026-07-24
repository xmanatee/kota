import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateProjectConfig } from "./config.js";

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("updateProjectConfig", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-project-config-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates secret-bearing project config with owner-only permissions", () => {
    updateProjectConfig(projectDir, (raw) => ({
      ...raw,
      webhooks: { deploy: { secret: "fresh-secret" } },
    }));

    const configDir = join(projectDir, ".kota");
    expect(modeOf(configDir)).toBe(0o700);
    expect(modeOf(join(configDir, "config.json"))).toBe(0o600);
  });

  it("repairs permissive permissions before updating secret-bearing project config", () => {
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        model: "claude-opus-4",
        webhooks: { deploy: { secret: "old-secret" } },
      }),
    );
    chmodSync(configDir, 0o755);
    chmodSync(configPath, 0o644);

    updateProjectConfig(projectDir, (raw) => ({
      ...raw,
      webhooks: { deploy: { secret: "rotated-secret" } },
    }));

    expect(modeOf(configDir)).toBe(0o700);
    expect(modeOf(configPath)).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({
      model: "claude-opus-4",
      webhooks: { deploy: { secret: "rotated-secret" } },
    });
  });
});
