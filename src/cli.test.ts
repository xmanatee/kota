import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(root, "dist/cli.js");

function run(...args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    encoding: "utf-8",
    timeout: 5000,
    cwd: root,
  });
}

describe("cli", () => {
  it("--help shows KOTA description", () => {
    const out = run("--help");
    expect(out).toContain("KOTA");
    expect(out).toContain("Keep Only The Awesome");
  });

  it("--version prints semver", () => {
    const out = run("--version");
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("run --help lists all run-specific options", () => {
    const out = run("run", "--help");
    expect(out).toContain("--model");
    expect(out).toContain("--interactive");
    expect(out).toContain("--architect");
    expect(out).toContain("--think");
    expect(out).toContain("--think-budget");
    expect(out).toContain("--session");
    expect(out).toContain("--yes");
    expect(out).toContain("--editor-model");
    expect(out).toContain("--max-tokens");
    expect(out).toContain("--verbose");
  });

  it("default model is claude-sonnet-4-6", () => {
    const out = run("run", "--help");
    expect(out).toContain("claude-sonnet-4-6");
  });
});
