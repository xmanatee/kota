import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectAstArchitectureObservations,
  detectDuplicateCanonicalOwnership,
  detectForbiddenCoreToModuleDependencies,
  detectModuleCycles,
  detectUndeclaredCrossModuleImports,
  extractAstImports,
} from "./ast-provider.js";

describe("AST Architecture Provider", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kota-ast-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("extractAstImports and isTypeOnlyImport", () => {
    it("differentiates runtime imports from type-only imports", () => {
      const code = `
        import { regularFn } from "#modules/foo/index.js";
        import type { FooType } from "#modules/bar/index.js";
        import { type InlineType, anotherFn } from "#modules/baz/index.js";
        import { type OnlyType1, type OnlyType2 } from "#modules/qux/index.js";
        export type { ExportedType } from "#modules/exp1/index.js";
        export { regularExport } from "#modules/exp2/index.js";
      `;
      const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
      const imports = extractAstImports(sourceFile);

      expect(imports).toEqual([
        { specifier: "#modules/foo/index.js", line: 2, isTypeOnly: false },
        { specifier: "#modules/bar/index.js", line: 3, isTypeOnly: true },
        { specifier: "#modules/baz/index.js", line: 4, isTypeOnly: false },
        { specifier: "#modules/qux/index.js", line: 5, isTypeOnly: true },
        { specifier: "#modules/exp1/index.js", line: 6, isTypeOnly: true },
        { specifier: "#modules/exp2/index.js", line: 7, isTypeOnly: false },
      ]);
    });
  });

  describe("detectForbiddenCoreToModuleDependencies", () => {
    it("detects forbidden core-to-module imports in src/core", () => {
      const coreDir = join(testDir, "src", "core");
      mkdirSync(coreDir, { recursive: true });

      writeFileSync(
        join(coreDir, "clean.ts"),
        `import { something } from "#core/util.js";`,
        "utf-8",
      );

      writeFileSync(
        join(coreDir, "bad.ts"),
        `import { forbidden } from "#modules/autonomy/shared.js";`,
        "utf-8",
      );

      const violations = detectForbiddenCoreToModuleDependencies(testDir);
      expect(violations).toHaveLength(1);
      expect(violations[0].sourceFile).toBe(join("src", "core", "bad.ts"));
      expect(violations[0].specifier).toBe("#modules/autonomy/shared.js");
    });
  });

  describe("detectUndeclaredCrossModuleImports", () => {
    it("detects undeclared runtime cross-module imports while ignoring type-only imports", () => {
      const modADir = join(testDir, "src", "modules", "module-a");
      const modBDir = join(testDir, "src", "modules", "module-b");
      const modCDir = join(testDir, "src", "modules", "module-c");
      mkdirSync(modADir, { recursive: true });
      mkdirSync(modBDir, { recursive: true });
      mkdirSync(modCDir, { recursive: true });

      // Module A declares dependency on module-b only
      writeFileSync(
        join(modADir, "index.ts"),
        `export default { name: "module-a", dependencies: ["module-b"] };`,
        "utf-8",
      );
      writeFileSync(
        join(modBDir, "index.ts"),
        `export default { name: "module-b", dependencies: [] };`,
        "utf-8",
      );
      writeFileSync(
        join(modCDir, "index.ts"),
        `export default { name: "module-c", dependencies: [] };`,
        "utf-8",
      );

      // Source in module-a:
      // 1. imports module-b (declared -> OK)
      // 2. imports module-c type-only (type-only -> OK)
      // 3. imports module-c runtime (undeclared -> VIOLATION)
      writeFileSync(
        join(modADir, "service.ts"),
        `
          import { bHelper } from "#modules/module-b/helper.js";
          import type { CType } from "#modules/module-c/types.js";
          import { cRuntime } from "#modules/module-c/runtime.js";
        `,
        "utf-8",
      );

      const violations = detectUndeclaredCrossModuleImports(testDir);
      expect(violations).toHaveLength(1);
      expect(violations[0].sourceModule).toBe("module-a");
      expect(violations[0].targetModule).toBe("module-c");
      expect(violations[0].specifier).toBe("#modules/module-c/runtime.js");
    });
  });

  describe("detectModuleCycles", () => {
    it("detects dependency cycles between modules", () => {
      const modADir = join(testDir, "src", "modules", "module-a");
      const modBDir = join(testDir, "src", "modules", "module-b");
      const modCDir = join(testDir, "src", "modules", "module-c");
      mkdirSync(modADir, { recursive: true });
      mkdirSync(modBDir, { recursive: true });
      mkdirSync(modCDir, { recursive: true });

      // Cycle: A -> B -> C -> A
      writeFileSync(
        join(modADir, "index.ts"),
        `export default { name: "module-a", dependencies: ["module-b"] };`,
        "utf-8",
      );
      writeFileSync(
        join(modBDir, "index.ts"),
        `export default { name: "module-b", dependencies: ["module-c"] };`,
        "utf-8",
      );
      writeFileSync(
        join(modCDir, "index.ts"),
        `export default { name: "module-c", dependencies: ["module-a"] };`,
        "utf-8",
      );

      const cycles = detectModuleCycles(testDir);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      expect(cycles.some((c) => c.cycle.includes("module-a") && c.cycle.includes("module-b"))).toBe(true);
    });
  });

  describe("detectDuplicateCanonicalOwnership", () => {
    it("detects duplicate canonical contributions across loaded modules", () => {
      const mockModules = [
        {
          name: "mod-1",
          workflows: [{ name: "daily-digest" }],
          events: [{ name: "item.created" } as any],
          tools: [{ tool: { name: "search_tool" } } as any],
        },
        {
          name: "mod-2",
          workflows: [{ name: "daily-digest" }],
          events: [{ name: "item.created" } as any],
          tools: [{ tool: { name: "search_tool" } } as any],
        },
      ];

      const duplicates = detectDuplicateCanonicalOwnership(testDir, mockModules as any);
      expect(duplicates).toHaveLength(3);
      expect(duplicates.some((d) => d.contributionKind === "workflow" && d.name === "daily-digest")).toBe(true);
      expect(duplicates.some((d) => d.contributionKind === "event" && d.name === "item.created")).toBe(true);
      expect(duplicates.some((d) => d.contributionKind === "tool" && d.name === "search_tool")).toBe(true);
    });
  });

  describe("collectAstArchitectureObservations", () => {
    it("collects typed observations with stable fingerprints", () => {
      const modDir = join(testDir, "src", "modules", "test-mod");
      mkdirSync(modDir, { recursive: true });
      writeFileSync(
        join(modDir, "index.ts"),
        `export default { name: "test-mod", dependencies: [] };`,
        "utf-8",
      );

      const obs = collectAstArchitectureObservations(testDir, {
        extraCycles: [{ from: "test-mod", to: "test-mod" }],
      });

      expect(obs.length).toBeGreaterThan(0);
      const cycleObs = obs.find((o) => o.kind === "module-dependency-cycle");
      expect(cycleObs).toBeDefined();
      expect(cycleObs?.fingerprint).toMatch(/^[a-f0-9]{24}$/);
      expect(cycleObs?.category).toBe("dependency-boundary");
    });
  });
});
