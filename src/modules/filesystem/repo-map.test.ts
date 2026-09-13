import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runRepoMap } from "./repo-map.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "repo-map-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function file(name: string, content: string): void {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

it.each([
  ["function.ts", "export function foo(): void {}", "fn foo(): void {}"],
  ["async.ts", "export async function bar(): Promise<void> {}", "fn bar(): Promise<void> {}"],
  ["class.ts", "export abstract class Base {}", "class Base"],
  ["const.ts", "export const MAX = 100;", "const MAX"],
  ["interface.ts", "export interface Options {}", "interface Options"],
  ["type.ts", "export type Result = string;", "type Result"],
  ["enum.ts", "export enum Color {}", "enum Color"],
  ["default.ts", "export default function main() {}", "default fn main() {}"],
  ["anonymous.ts", "export default function() {}", "default fn (anon)() {}"],
  ["python.py", "def hello(name):", "def hello(name):"],
  ["async.py", "async def fetch(url):", "async def fetch(url):"],
  ["class.py", "class Model(Base):", "class Model(Base):"],
])("extracts visible symbols from %s", async (name, source, expected) => {
  file(name, `  ${source}`);
  expect((await runRepoMap({}, { cwd: root })).content).toBe(`${name}\n  ${expected}`);
});

it("selects nested source and excludes private declarations, dependencies and type stubs", async () => {
  file("src/utils.ts", "export function helper() {}\nfunction internal() {}\nexport const VERSION = 1;");
  file("model.py", "class User:\n    def method(self):\n        pass");
  file("private.ts", "const local = 1;");
  file("node_modules/dependency.ts", "export const SECRET = 1;");
  file("types.d.ts", "export type Secret = string;");
  const result = await runRepoMap({}, { cwd: root });
  expect(result.content).toBe("model.py\n  class User:\n  def method(self):\nsrc/utils.ts\n  fn helper() {}\n  const VERSION");
  expect((await runRepoMap({ pattern: "**/*.py" }, { cwd: root })).content).toBe("model.py\n  class User:\n  def method(self):");
});

it("distinguishes missing source from source without exports", async () => {
  expect((await runRepoMap({}, { cwd: root })).content).toBe("No source files found.");
  file("private.ts", "const internal = 1;");
  expect((await runRepoMap({}, { cwd: root })).content).toBe("No exported symbols found in scanned files.");
});

it("excludes protected credentials even for a matching pattern", async () => {
  file(".KOTA/secrets.json", 'export const API_KEY = "synthetic-secret";');
  expect((await runRepoMap({ directory: ".KOTA", pattern: "**/*" }, { cwd: root })).content).toBe("No source files found.");
});

it("bounds long signatures without losing symbol identity", async () => {
  file("large.ts", `export function process(${"a: string, ".repeat(10)}): void {}`);
  const result = await runRepoMap({}, { cwd: root });
  expect(result.content).toContain("fn process(");
  expect(result.content).toMatch(/\.\.\.$/);
  expect(result.content.split("\n")[1].length).toBeLessThan(90);
});

it("keeps patterns and resolved source files inside the selected directory", async () => {
  file("private/secret.py", "private_value = 1\ndef private_value(): pass");
  mkdirSync(join(root, "workspace"));
  symlinkSync(join(root, "private", "secret.py"), join(root, "workspace", "alias.py"));

  expect(await runRepoMap(
    { directory: "workspace", pattern: "../private/**/*.py" },
    { cwd: root },
  )).toMatchObject({
    is_error: true,
    content: expect.stringContaining("pattern must stay within directory"),
  });
  expect(await runRepoMap(
    { directory: "workspace", pattern: "**/*.py" },
    { cwd: root },
  )).toEqual({ content: "No source files found." });
});
