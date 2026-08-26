import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateScopeConfig } from "./config.js";

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("updateScopeConfig", () => {
  let scopeRoot: string;
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-scope-config-"));
    cleanupDirs.push(scopeRoot);
  });

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates secret-bearing scope config with owner-only permissions", () => {
    updateScopeConfig(scopeRoot, (raw) => ({
      ...raw,
      webhooks: { deploy: { secret: "fresh-secret" } },
    }));

    const configDir = join(scopeRoot, ".kota");
    expect(modeOf(configDir)).toBe(0o700);
    expect(modeOf(join(configDir, "config.json"))).toBe(0o600);
  });

  it("repairs permissive permissions before updating secret-bearing scope config", () => {
    const configDir = join(scopeRoot, ".kota");
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

    updateScopeConfig(scopeRoot, (raw) => ({
      ...raw,
      webhooks: { deploy: { secret: "rotated-secret" } },
    }));

    expect(modeOf(configDir)).toBe(0o700);
    expect(modeOf(configPath)).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({
      model: "claude-opus-4",
      webhooks: { deploy: { secret: "rotated-secret" } },
    });
    expect(readdirSync(configDir)).toEqual(["config.json"]);
  });

  it("repairs permissions and keeps the existing config intact when serialization fails", () => {
    const configDir = join(scopeRoot, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir);
    const original = '{"webhooks":{"deploy":{"secret":"old-secret"}}}\n';
    writeFileSync(configPath, original);
    chmodSync(configDir, 0o755);
    chmodSync(configPath, 0o644);

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => {
        const cyclic = { ...raw };
        Object.assign(cyclic, { cyclic });
        return cyclic;
      })
    ).toThrow(/circular structure/i);

    expect(readFileSync(configPath, "utf-8")).toBe(original);
    expect(modeOf(configDir)).toBe(0o700);
    expect(modeOf(configPath)).toBe(0o600);
    expect(readdirSync(configDir)).toEqual(["config.json"]);
  });

  it("rejects a symbolic-link config directory without touching its external target", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-scope-config-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideConfigPath = join(outsideDir, "config.json");
    writeFileSync(outsideConfigPath, '{"model":"outside"}\n');
    chmodSync(outsideDir, 0o755);
    chmodSync(outsideConfigPath, 0o644);
    const configDir = join(scopeRoot, ".kota");
    symlinkSync(outsideDir, configDir, "dir");

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => ({
        ...raw,
        model: "must-not-escape",
      }))
    ).toThrow(/symbolic link/);

    expect(lstatSync(configDir).isSymbolicLink()).toBe(true);
    expect(modeOf(outsideDir)).toBe(0o755);
    expect(modeOf(outsideConfigPath)).toBe(0o644);
    expect(readFileSync(outsideConfigPath, "utf-8")).toBe(
      '{"model":"outside"}\n',
    );
  });

  it("rejects a symbolic-link config file before changing permissions or contents", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-scope-config-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideConfigPath = join(outsideDir, "outside.json");
    writeFileSync(outsideConfigPath, '{"model":"outside"}\n');
    chmodSync(outsideConfigPath, 0o644);
    const configDir = join(scopeRoot, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { mode: 0o755 });
    symlinkSync(outsideConfigPath, configPath);

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => ({
        ...raw,
        model: "must-not-escape",
      }))
    ).toThrow(/symbolic link/);

    expect(modeOf(configDir)).toBe(0o755);
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(modeOf(outsideConfigPath)).toBe(0o644);
    expect(readFileSync(outsideConfigPath, "utf-8")).toBe(
      '{"model":"outside"}\n',
    );
  });

  it("rejects a hard-linked config file before changing its shared inode", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-scope-config-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideConfigPath = join(outsideDir, "outside.json");
    writeFileSync(outsideConfigPath, '{"model":"outside"}\n');
    chmodSync(outsideConfigPath, 0o644);
    const configDir = join(scopeRoot, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { mode: 0o755 });
    linkSync(outsideConfigPath, configPath);

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => ({
        ...raw,
        model: "must-not-touch-shared-inode",
      }))
    ).toThrow(/hard links/);

    expect(modeOf(configDir)).toBe(0o755);
    expect(modeOf(outsideConfigPath)).toBe(0o644);
    expect(readFileSync(outsideConfigPath, "utf-8")).toBe(
      '{"model":"outside"}\n',
    );
  });

  it("rejects a non-regular config file before changing directory permissions", () => {
    const configDir = join(scopeRoot, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configPath, { recursive: true, mode: 0o755 });

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => ({
        ...raw,
        model: "must-not-replace-directory",
      }))
    ).toThrow(/regular file/);

    expect(modeOf(configDir)).toBe(0o755);
    expect(statSync(configPath).isDirectory()).toBe(true);
  });

  it("rejects a config directory swapped for a symbolic link during the update", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-scope-config-outside-"));
    cleanupDirs.push(outsideDir);
    const configDir = join(scopeRoot, ".kota");
    const parkedConfigDir = join(scopeRoot, ".kota-parked");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir);
    writeFileSync(configPath, '{"model":"inside"}\n');

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => {
        renameSync(configDir, parkedConfigDir);
        symlinkSync(outsideDir, configDir, "dir");
        return {
          ...raw,
          webhooks: { deploy: { secret: "must-not-escape" } },
        };
      })
    ).toThrow(/config directory (?:changed during the update|must not be a symbolic link)/);

    expect(readdirSync(outsideDir)).toEqual([]);
    expect(readFileSync(join(parkedConfigDir, "config.json"), "utf-8")).toBe(
      '{"model":"inside"}\n',
    );
    unlinkSync(configDir);
    renameSync(parkedConfigDir, configDir);
  });

  it("rejects a scope root replaced by a symbolic link during the update", () => {
    const relocatedScopeRoot = `${scopeRoot}-relocated`;
    cleanupDirs.push(relocatedScopeRoot);
    const configDir = join(scopeRoot, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir);
    writeFileSync(configPath, '{"model":"inside"}\n');

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => {
        renameSync(scopeRoot, relocatedScopeRoot);
        symlinkSync(relocatedScopeRoot, scopeRoot, "dir");
        return {
          ...raw,
          webhooks: { deploy: { secret: "must-not-escape" } },
        };
      })
    ).toThrow(/scope root (?:changed during the update|must not be a symbolic link)/);

    expect(lstatSync(scopeRoot).isSymbolicLink()).toBe(true);
    expect(
      readFileSync(
        join(relocatedScopeRoot, ".kota", "config.json"),
        "utf-8",
      ),
    ).toBe('{"model":"inside"}\n');
    expect(readdirSync(join(relocatedScopeRoot, ".kota"))).toEqual([
      "config.json",
    ]);
  });

  it("rejects a scope root reached through a replaced ancestor", () => {
    const scopeParent = mkdtempSync(join(tmpdir(), "kota-scope-parent-"));
    const relocatedScopeParent = `${scopeParent}-relocated`;
    cleanupDirs.push(scopeParent, relocatedScopeParent);
    scopeRoot = join(scopeParent, "scope");
    const configDir = join(scopeRoot, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, '{"model":"inside"}\n');

    expect(() =>
      updateScopeConfig(scopeRoot, (raw) => {
        renameSync(scopeParent, relocatedScopeParent);
        symlinkSync(relocatedScopeParent, scopeParent, "dir");
        return {
          ...raw,
          webhooks: { deploy: { secret: "must-not-escape" } },
        };
      })
    ).toThrow(/scope root changed during the update/);

    expect(lstatSync(scopeParent).isSymbolicLink()).toBe(true);
    expect(
      readFileSync(
        join(relocatedScopeParent, "scope", ".kota", "config.json"),
        "utf-8",
      ),
    ).toBe('{"model":"inside"}\n');
  });
});
