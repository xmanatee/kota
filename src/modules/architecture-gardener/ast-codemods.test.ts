import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  codemodAddModuleDependency,
  codemodRemoveUnusedImport,
} from "./ast-codemods.js";

describe("AST Codemods", () => {
  let testDir: string;
  beforeEach(() => {
    testDir = join(tmpdir(), `kota-codemod-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("codemodAddModuleDependency", () => {
    it("adds missing dependency to existing dependencies array idempotently", () => {
      const filePath = join(testDir, "index.ts");
      writeFileSync(filePath, 'export default { name: "test-module", dependencies: ["repo-tasks"] };', "utf-8");
      const res1 = codemodAddModuleDependency(filePath, "autonomy", true);
      expect(res1.modified).toBe(true);
      expect(res1.content).toContain('"autonomy"');
      expect(res1.content).toContain('"repo-tasks"');
      const res2 = codemodAddModuleDependency(filePath, "autonomy", true);
      expect(res2.modified).toBe(false);
    });

    it("adds dependencies array when not present in module definition", () => {
      const filePath = join(testDir, "index.ts");
      writeFileSync(filePath, 'export default { name: "test-module", version: "1.0.0" };', "utf-8");
      const res = codemodAddModuleDependency(filePath, "rendering", true);
      expect(res.modified).toBe(true);
      expect(res.content).toContain('dependencies: ["rendering"]');
    });
  });

  describe("codemodRemoveUnusedImport", () => {
    it("removes specified import declaration cleanly", () => {
      const filePath = join(testDir, "service.ts");
      writeFileSync(filePath, 'import { used } from "#core/util.js";\nimport { unused } from "#modules/dead/index.js";\nexport function run() { return used(); }', "utf-8");
      const res = codemodRemoveUnusedImport(filePath, "#modules/dead/index.js", true);
      expect(res.modified).toBe(true);
      expect(res.content).not.toContain("#modules/dead/index.js");
      expect(res.content).toContain("#core/util.js");
    });
  });
});