import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { formatCountOutput, runGrep } from "./grep.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "grep-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "main.ts"), "before\nconst x = 42;\nconst y = 42;\nafter");
  writeFileSync(join(root, "src", "nested.py"), "def world():\n    return 42");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

it.each([{}, { files_only: true }, { count_only: true }])("searches nested files and applies filtering in mode %j", async (mode) => {
  const all = await runGrep({ pattern: "42", ...mode }, { cwd: root });
  expect(all.is_error).toBeUndefined();
  expect(all.content).toContain("main.ts");
  expect(all.content).toContain("nested.py");
  if ("files_only" in mode) expect(all.content).not.toMatch(/:\d+:/);
  else if ("count_only" in mode) expect(all.content).toContain("Total: 3 matches in 2 files");
  else expect(all.content).toContain("main.ts:2:const x = 42;");
  const filtered = await runGrep({ pattern: "42", file_glob: "*.py", ...mode }, { cwd: root });
  expect(filtered.content).toContain("nested.py");
  expect(filtered.content).not.toContain("main.ts");
  expect(await runGrep({ pattern: "absent", ...mode }, { cwd: root })).toEqual({ content: "No matches found." });
  expect(await runGrep({ pattern: "[invalid", ...mode }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("Search error") });
});

it("propagates regex, line context and a non-vacuous result limit", async () => {
  const result = await runGrep({ pattern: "const [xy]", path: "main.ts", max_results: 1, context_lines: 1 }, { cwd: root });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toContain("before");
  expect(result.content).toContain("const x");
  const limited = await runGrep({ pattern: "const [xy]", path: "main.ts", max_results: 1 }, { cwd: root });
  expect(limited.content).toContain("const x");
  expect(limited.content).not.toContain("const y");
  expect((await runGrep({ pattern: "def world\\(\\)" }, { cwd: root })).content).toContain("def world()");
});

it.each(["max_results", "context_lines"])("rejects injection in %s without executing it", async (field) => {
  const marker = join(root, "injected");
  expect(await runGrep({ pattern: "42", [field]: `1; touch ${marker} #` }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining(`${field} must be a finite integer`) });
  expect(existsSync(marker)).toBe(false);
});

it.each([
  { max_results: 0 }, { max_results: 1.5 }, { max_results: 10001 },
  { context_lines: -1 }, { context_lines: 1.5 }, { context_lines: 101 },
])("rejects invalid numeric options %j", async (input) => {
  expect(await runGrep({ pattern: "42", ...input }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("must be a finite integer") });
});

it("rejects an empty search pattern", async () => {
  expect(await runGrep({ pattern: "" }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("pattern is required") });
});

it.each([".kota/daemon-control.json", ".kota/secrets.json", ".env", ".env.local"])("rejects direct credential search %s", async (path) => {
  expect(await runGrep({ path, pattern: "token" }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("protected scope runtime credential") });
});

it("excludes case aliases and custom operator credentials from recursive search", async () => {
  mkdirSync(join(root, ".KOTA"));
  for (const name of ["daemon-control.json", "secrets.json"]) writeFileSync(join(root, ".KOTA", name), "synthetic-secret");
  const token = join(root, "machine[proof]*.dat");
  writeFileSync(token, "synthetic-secret");
  writeFileSync(join(root, "public.txt"), "public-observation");
  vi.stubEnv("KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH", token);
  const context = { cwd: root, authorityConfigPath: join(root, "config.json") };
  expect(await runGrep({ pattern: "synthetic-secret", path: ".KOTA" }, context)).toEqual({ content: "No matches found." });
  expect(await runGrep({ pattern: "synthetic-secret" }, context)).toEqual({ content: "No matches found." });
  expect((await runGrep({ pattern: "public-observation" }, context)).content).toContain("public.txt");
});

it("normalizes count output from grep backends including empty and zero-count entries", () => {
  expect(formatCountOutput("a.ts:5\nb.ts:0\nc.ts:3")).toBe("a.ts:5\nc.ts:3\n\nTotal: 8 matches in 2 files");
  expect(formatCountOutput("a.ts:0\nb.ts:0")).toBe("No matches found.");
  expect(formatCountOutput("")).toBe("No matches found.");
});

// A PATH containing only grep exercises the supported fallback with a real process.
it.each(["ripgrep", "grep"])("hides daemon lock credentials from direct and recursive %s searches", async (backend) => {
  if (backend === "grep") {
    const bin = join(root, "bin");
    mkdirSync(bin);
    symlinkSync("/usr/bin/grep", join(bin, "grep"));
    vi.stubEnv("PATH", bin);
  }
  mkdirSync(join(root, ".kota"));
  const token = "synthetic-instance-lock-bearer";
  const lock = join(root, ".kota", "daemon-instance.lock");
  writeFileSync(lock, JSON.stringify({ token }));
  symlinkSync(lock, join(root, "notes.json"));
  symlinkSync(join(root, ".kota"), join(root, "runtime-alias"));
  writeFileSync(join(root, ".kota", "public.txt"), "repository-visible");
  writeFileSync(join(root, "public.txt"), "repository-visible");
  for (const path of [lock, "notes.json", "runtime-alias/daemon-instance.lock"]) {
    const result = await runGrep({ path, pattern: token }, { cwd: root });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("protected scope runtime credential") });
    expect(result.content).not.toContain(token);
  }
  for (const path of [".", ".kota", "runtime-alias"]) {
    expect(await runGrep({ path, pattern: token }, { cwd: root })).toEqual({ content: "No matches found." });
    expect((await runGrep({ path, pattern: "repository-visible" }, { cwd: root })).content).toContain("public.txt");
  }
});

it("aggregates matching files across search batches", async () => {
  for (let index = 0; index < 70; index++) {
    writeFileSync(join(root, `entry-${index}.txt`), "batch match\nbatch match\n");
  }
  const result = await runGrep({ pattern: "batch match", path: root, count_only: true });
  expect(result.is_error).not.toBe(true);
  expect(result.content).toContain("Total: 140 matches in 70 files");
});
