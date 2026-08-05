import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareCodexRuntimeEnvironment,
  resolveCodexHome,
} from "./runtime-home.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Codex runtime home", () => {
  it("resolves an explicit Codex home before HOME", () => {
    expect(resolveCodexHome({ CODEX_HOME: "/custom/codex", HOME: "/operator" }))
      .toBe("/custom/codex");
    expect(resolveCodexHome({ HOME: "/operator" })).toBe("/operator/.codex");
  });

  it("copies only login material into an isolated writable runtime home", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-codex-runtime-home-test-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const invocationRoot = join(root, "invocation");
    mkdirSync(sourceHome);
    mkdirSync(invocationRoot);
    writeFileSync(join(sourceHome, "auth.json"), "{\"auth_mode\":\"chatgpt\"}");
    writeFileSync(join(sourceHome, "config.toml"), "model = \"operator-default\"");
    writeFileSync(join(sourceHome, "state_5.sqlite"), "state");

    const env = prepareCodexRuntimeEnvironment({
      invocationRoot,
      toolRuntimeRoot: join(invocationRoot, "tool-runtime"),
      readableRoots: ["/repo", "/usr"],
      writableRoots: ["/repo/src"],
      readProtectedPaths: ["/repo/.env"],
      writeProtectedPaths: ["/repo/.git"],
    }, {
      CODEX_HOME: sourceHome,
      KOTA_TEST_ENV: "preserved",
    });

    expect(env).toMatchObject({
      CODEX_HOME: join(invocationRoot, "codex-home"),
      KOTA_TEST_ENV: "preserved",
    });
    expect(readFileSync(join(env.CODEX_HOME!, "auth.json"), "utf8"))
      .toBe("{\"auth_mode\":\"chatgpt\"}");
    const config = readFileSync(join(env.CODEX_HOME!, "config.toml"), "utf8");
    expect(config).toContain('default_permissions = "kota-native"');
    expect(config).toContain('approval_policy = "untrusted"');
    expect(config).toContain('"/repo/src" = "write"');
    expect(config).toContain('"/repo/.env" = "deny"');
    expect(config).toContain('"/repo/.git" = "read"');
    expect(config).toContain("enabled = false");
    expect(config).not.toContain("operator-default");
    expect(() => readFileSync(join(env.CODEX_HOME!, "state_5.sqlite"), "utf8"))
      .toThrow();
  });
});
