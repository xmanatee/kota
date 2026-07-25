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
import { updateProjectConfig } from "./config.js";

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("updateProjectConfig", () => {
  let projectDir: string;
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-project-config-"));
    cleanupDirs.push(projectDir);
  });

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0).reverse()) {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(readdirSync(configDir)).toEqual(["config.json"]);
  });

  it("repairs permissions and keeps the existing config intact when serialization fails", () => {
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir);
    const original = '{"webhooks":{"deploy":{"secret":"old-secret"}}}\n';
    writeFileSync(configPath, original);
    chmodSync(configDir, 0o755);
    chmodSync(configPath, 0o644);

    expect(() =>
      updateProjectConfig(projectDir, (raw) => {
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
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-project-config-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideConfigPath = join(outsideDir, "config.json");
    writeFileSync(outsideConfigPath, '{"model":"outside"}\n');
    chmodSync(outsideDir, 0o755);
    chmodSync(outsideConfigPath, 0o644);
    const configDir = join(projectDir, ".kota");
    symlinkSync(outsideDir, configDir, "dir");

    expect(() =>
      updateProjectConfig(projectDir, (raw) => ({
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
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-project-config-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideConfigPath = join(outsideDir, "outside.json");
    writeFileSync(outsideConfigPath, '{"model":"outside"}\n');
    chmodSync(outsideConfigPath, 0o644);
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { mode: 0o755 });
    symlinkSync(outsideConfigPath, configPath);

    expect(() =>
      updateProjectConfig(projectDir, (raw) => ({
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
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-project-config-outside-"));
    cleanupDirs.push(outsideDir);
    const outsideConfigPath = join(outsideDir, "outside.json");
    writeFileSync(outsideConfigPath, '{"model":"outside"}\n');
    chmodSync(outsideConfigPath, 0o644);
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { mode: 0o755 });
    linkSync(outsideConfigPath, configPath);

    expect(() =>
      updateProjectConfig(projectDir, (raw) => ({
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
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configPath, { recursive: true, mode: 0o755 });

    expect(() =>
      updateProjectConfig(projectDir, (raw) => ({
        ...raw,
        model: "must-not-replace-directory",
      }))
    ).toThrow(/regular file/);

    expect(modeOf(configDir)).toBe(0o755);
    expect(statSync(configPath).isDirectory()).toBe(true);
  });

  it("rejects a config directory swapped for a symbolic link during the update", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "kota-project-config-outside-"));
    cleanupDirs.push(outsideDir);
    const configDir = join(projectDir, ".kota");
    const parkedConfigDir = join(projectDir, ".kota-parked");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir);
    writeFileSync(configPath, '{"model":"inside"}\n');

    expect(() =>
      updateProjectConfig(projectDir, (raw) => {
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

  it("rejects a project root replaced by a symbolic link during the update", () => {
    const relocatedProjectDir = `${projectDir}-relocated`;
    cleanupDirs.push(relocatedProjectDir);
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir);
    writeFileSync(configPath, '{"model":"inside"}\n');

    expect(() =>
      updateProjectConfig(projectDir, (raw) => {
        renameSync(projectDir, relocatedProjectDir);
        symlinkSync(relocatedProjectDir, projectDir, "dir");
        return {
          ...raw,
          webhooks: { deploy: { secret: "must-not-escape" } },
        };
      })
    ).toThrow(/project root (?:changed during the update|must not be a symbolic link)/);

    expect(lstatSync(projectDir).isSymbolicLink()).toBe(true);
    expect(
      readFileSync(
        join(relocatedProjectDir, ".kota", "config.json"),
        "utf-8",
      ),
    ).toBe('{"model":"inside"}\n');
    expect(readdirSync(join(relocatedProjectDir, ".kota"))).toEqual([
      "config.json",
    ]);
  });

  it("rejects a project root reached through a replaced ancestor", () => {
    const projectParent = mkdtempSync(join(tmpdir(), "kota-project-parent-"));
    const relocatedProjectParent = `${projectParent}-relocated`;
    cleanupDirs.push(projectParent, relocatedProjectParent);
    projectDir = join(projectParent, "project");
    const configDir = join(projectDir, ".kota");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, '{"model":"inside"}\n');

    expect(() =>
      updateProjectConfig(projectDir, (raw) => {
        renameSync(projectParent, relocatedProjectParent);
        symlinkSync(relocatedProjectParent, projectParent, "dir");
        return {
          ...raw,
          webhooks: { deploy: { secret: "must-not-escape" } },
        };
      })
    ).toThrow(/project root changed during the update/);

    expect(lstatSync(projectParent).isSymbolicLink()).toBe(true);
    expect(
      readFileSync(
        join(relocatedProjectParent, "project", ".kota", "config.json"),
        "utf-8",
      ),
    ).toBe('{"model":"inside"}\n');
  });
});
