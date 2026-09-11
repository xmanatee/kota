import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isProtectedScopePath } from "./protected-scope-paths.js";

let root: string;
let scope: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "protected-paths-"));
  scope = join(root, "scope");
  mkdirSync(join(scope, ".kota"), { recursive: true });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it("protects file and directory symlinks to scope credentials while allowing ordinary files", () => {
  writeFileSync(join(scope, ".kota", "secrets.json"), "{}");
  writeFileSync(join(scope, ".env"), "TOKEN=synthetic");
  writeFileSync(join(scope, "public.txt"), "ordinary");
  symlinkSync(join(scope, ".kota", "secrets.json"), join(scope, "secret-alias"));
  symlinkSync(join(scope, ".env"), join(scope, "env-alias"));
  symlinkSync(join(scope, ".kota"), join(scope, "runtime-alias"), "dir");
  for (const path of ["secret-alias", join(scope, "env-alias"), "runtime-alias/secrets.json"]) expect(isProtectedScopePath(path, { cwd: scope })).toBe(true);
  expect(isProtectedScopePath("public.txt", { cwd: scope })).toBe(false);
});

it("protects an external operator token and a scope-local alias", () => {
  const token = join(root, "scope-authority-token.json");
  const context = { cwd: scope, authorityConfigPath: join(root, "config.json") };
  expect(isProtectedScopePath(token, context)).toBe(true);
  writeFileSync(token, "synthetic-token");
  symlinkSync(token, join(scope, "notes.json"));
  expect(isProtectedScopePath("notes.json", context)).toBe(true);
});
