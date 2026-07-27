import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileProvider } from "./secrets.js";

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("FileProvider secure storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-secret-file-storage-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a symbolic-link secret file without changing its target", () => {
    const target = join(dir, "outside.json");
    const path = join(dir, "secrets.json");
    const original = '{"SAFE":"unchanged"}\n';
    writeFileSync(target, original);
    chmodSync(target, 0o644);
    symlinkSync(target, path);

    const provider = new FileProvider(path);

    expect(() => provider.get("SAFE")).toThrow(/symbolic link/);
    expect(() => provider.set("ATTACKER", "secret-value")).toThrow(
      /symbolic link/,
    );
    expect(readFileSync(target, "utf-8")).toBe(original);
    expect(modeOf(target)).toBe(0o644);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  it("rejects a symbolic-link parent without changing files in its target", () => {
    const projectDir = join(dir, "project");
    const outsideDir = join(dir, "outside");
    const target = join(outsideDir, "secrets.json");
    const original = '{"SAFE":"unchanged"}\n';
    mkdirSync(projectDir);
    mkdirSync(outsideDir);
    writeFileSync(target, original);
    chmodSync(outsideDir, 0o755);
    chmodSync(target, 0o644);
    symlinkSync(outsideDir, join(projectDir, ".kota"), "dir");

    const provider = new FileProvider(
      join(projectDir, ".kota", "secrets.json"),
    );

    expect(() => provider.set("ATTACKER", "secret-value")).toThrow(
      /symbolic link/,
    );
    expect(readFileSync(target, "utf-8")).toBe(original);
    expect(modeOf(outsideDir)).toBe(0o755);
    expect(modeOf(target)).toBe(0o644);
  });

  it("atomically replaces an existing secret file", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, '{"KEY":"old"}\n');
    const originalInode = statSync(path).ino;
    const provider = new FileProvider(path);

    expect(provider.get("KEY")).toBe("old");
    provider.set("KEY", "new");

    expect(statSync(path).ino).not.toBe(originalInode);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ KEY: "new" });
    expect(readdirSync(dir)).toEqual(["secrets.json"]);
  });
});
