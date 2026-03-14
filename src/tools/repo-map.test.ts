import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractSymbols, trimSig, runRepoMap } from "./repo-map.js";

// --- Pure function tests ---

describe("trimSig", () => {
  it("returns short strings unchanged", () => {
    expect(trimSig("(a: string): void")).toBe("(a: string): void");
  });

  it("truncates strings longer than 60 chars", () => {
    const long = "a".repeat(80);
    const result = trimSig(long);
    expect(result).toHaveLength(60);
    expect(result.endsWith("...")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(trimSig("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(trimSig("")).toBe("");
  });
});

describe("extractSymbols", () => {
  describe("TypeScript", () => {
    it("exported function", () => {
      const r = extractSymbols("export function foo(): void {}", false);
      expect(r).toEqual(["  fn foo(): void {}"]);
    });

    it("exported async function", () => {
      const r = extractSymbols(
        "export async function bar(): Promise<void> {}",
        false,
      );
      expect(r).toEqual(["  fn bar(): Promise<void> {}"]);
    });

    it("exported class", () => {
      const r = extractSymbols("export class MyClass {", false);
      expect(r).toEqual(["  class MyClass"]);
    });

    it("exported abstract class", () => {
      const r = extractSymbols("export abstract class Base {", false);
      expect(r).toEqual(["  class Base"]);
    });

    it("exported const", () => {
      const r = extractSymbols("export const MAX = 100;", false);
      expect(r).toEqual(["  const MAX"]);
    });

    it("exported interface", () => {
      const r = extractSymbols("export interface Options {", false);
      expect(r).toEqual(["  interface Options"]);
    });

    it("exported type", () => {
      const r = extractSymbols("export type Result = string;", false);
      expect(r).toEqual(["  type Result"]);
    });

    it("exported enum", () => {
      const r = extractSymbols("export enum Color {", false);
      expect(r).toEqual(["  enum Color"]);
    });

    it("export default function with name", () => {
      const r = extractSymbols("export default function main() {}", false);
      expect(r).toEqual(["  default fn main() {}"]);
    });

    it("export default anonymous function", () => {
      const r = extractSymbols("export default function() {}", false);
      expect(r).toEqual(["  default fn (anon)() {}"]);
    });

    it("ignores non-exported declarations", () => {
      const content = "function priv() {}\nconst local = 1;\nclass Inner {}";
      expect(extractSymbols(content, false)).toEqual([]);
    });

    it("extracts multiple symbols", () => {
      const content = [
        "import { x } from 'y';",
        "export function foo() {}",
        "const internal = 1;",
        "export class Bar {}",
        "export type Baz = string;",
      ].join("\n");
      const result = extractSymbols(content, false);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain("fn foo");
      expect(result[1]).toContain("class Bar");
      expect(result[2]).toContain("type Baz");
    });

    it("handles indented exports", () => {
      const r = extractSymbols("  export function indented() {}", false);
      expect(r).toHaveLength(1);
      expect(r[0]).toContain("fn indented");
    });
  });

  describe("Python", () => {
    it("extracts def", () => {
      const r = extractSymbols("def hello(name):", true);
      expect(r).toHaveLength(1);
      expect(r[0]).toContain("def hello");
    });

    it("extracts async def", () => {
      const r = extractSymbols("async def fetch(url):", true);
      expect(r).toHaveLength(1);
      expect(r[0]).toContain("async ");
      expect(r[0]).toContain("def fetch");
    });

    it("extracts class", () => {
      const r = extractSymbols("class Model(Base):", true);
      expect(r).toHaveLength(1);
      expect(r[0]).toContain("class Model");
    });

    it("extracts multiple Python symbols", () => {
      const content = [
        "import os",
        "def foo():",
        "    pass",
        "class Bar:",
        "    def method(self):",
      ].join("\n");
      const result = extractSymbols(content, true);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("truncates long signatures", () => {
    const longSig =
      "export function process(" + "a: string, ".repeat(10) + "): void {}";
    const result = extractSymbols(longSig, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("...");
  });
});

// --- Integration tests with real filesystem ---

describe("runRepoMap", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "repomap-test-"));

    writeFileSync(
      join(dir, "utils.ts"),
      [
        "export function helper(x: number): number { return x; }",
        "export const VERSION = '1.0';",
        "function internal() {}",
      ].join("\n"),
    );

    writeFileSync(
      join(dir, "model.py"),
      [
        "class User:",
        "    def __init__(self, name):",
        "        self.name = name",
        "",
        "def create_user(name):",
        "    return User(name)",
      ].join("\n"),
    );

    writeFileSync(join(dir, "empty.ts"), "// no exports\nconst x = 1;");

    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "dep.ts"), "export const D = 1;");

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "export class App {}");

    writeFileSync(join(dir, "types.d.ts"), "export type X = string;");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 'No source files found' for empty directory", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "empty-"));
    const result = await runRepoMap({ directory: emptyDir });
    expect(result.content).toBe("No source files found.");
    rmSync(emptyDir, { recursive: true });
  });

  it("returns file paths with exported symbols", async () => {
    const result = await runRepoMap({ directory: dir });
    expect(result.content).toContain("utils.ts");
    expect(result.content).toContain("fn helper");
    expect(result.content).toContain("const VERSION");
  });

  it("skips files with no exports", async () => {
    const result = await runRepoMap({ directory: dir });
    expect(result.content).not.toContain("empty.ts");
  });

  it("handles Python files", async () => {
    const result = await runRepoMap({ directory: dir });
    expect(result.content).toContain("model.py");
    expect(result.content).toContain("class User");
  });

  it("ignores node_modules", async () => {
    const result = await runRepoMap({ directory: dir });
    expect(result.content).not.toContain("dep.ts");
  });

  it("ignores .d.ts files", async () => {
    const result = await runRepoMap({ directory: dir });
    expect(result.content).not.toContain("types.d.ts");
  });

  it("includes nested files", async () => {
    const result = await runRepoMap({ directory: dir });
    expect(result.content).toContain("src/app.ts");
    expect(result.content).toContain("class App");
  });

  it("uses custom glob pattern", async () => {
    const result = await runRepoMap({ directory: dir, pattern: "**/*.py" });
    expect(result.content).toContain("model.py");
    expect(result.content).not.toContain("utils.ts");
  });

  it("returns 'No exported symbols' when files have no exports", async () => {
    const noExportDir = mkdtempSync(join(tmpdir(), "noexport-"));
    writeFileSync(join(noExportDir, "plain.ts"), "const x = 1;");
    const result = await runRepoMap({ directory: noExportDir });
    expect(result.content).toBe("No exported symbols found in scanned files.");
    rmSync(noExportDir, { recursive: true });
  });
});
