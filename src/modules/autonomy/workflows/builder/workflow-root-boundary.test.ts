import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_ENTRYPOINT_SOURCES } from "#core/root-layout.js";
import { checkModuleBoundary } from "./repair-checks.js";

function makeTmpProject(): string {
  const dir = join(tmpdir(), `kota-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("checkModuleBoundary", () => {
  it("passes allowed src root shapes", () => {
    const empty = makeTmpProject();
    expect(checkModuleBoundary(empty)).toBe("OK: no root helper drift detected");

    const allowed = makeTmpProject();
    writeFileSync(join(allowed, "src/cli.ts"), "export {};");
    writeFileSync(join(allowed, "src/init.ts"), "export {};");
    writeFileSync(join(allowed, "src/capability.test.ts"), "// test");
    writeFileSync(join(allowed, "src/feature.integration.test.ts"), "// integration test");
    writeFileSync(join(allowed, "src/env.d.ts"), "declare module 'x';");
    writeFileSync(join(allowed, "src/conversational-cross-store-fixture.integration.ts"), "export {};");
    expect(checkModuleBoundary(allowed)).toBe("OK: no root helper drift detected");

    const noSrc = join(tmpdir(), `kota-nosrc-${Date.now()}`);
    mkdirSync(noSrc, { recursive: true });
    expect(checkModuleBoundary(noSrc)).toBe("OK: no src/ directory");
  });

  it("fails when non-allowlisted production files exist in src root", () => {
    const oneFile = makeTmpProject();
    writeFileSync(join(oneFile, "src/new-capability.ts"), "export {};");
    expect(() => checkModuleBoundary(oneFile)).toThrow(/Unexpected production files in src\/ root/);
    expect(() => checkModuleBoundary(oneFile)).toThrow("new-capability.ts");
    expect(() => checkModuleBoundary(oneFile)).toThrow(/src\/core\/ or src\/modules\//);

    const multiple = makeTmpProject();
    writeFileSync(join(multiple, "src/feature-a.ts"), "export {};");
    writeFileSync(join(multiple, "src/feature-b.ts"), "export {};");
    expect(() => checkModuleBoundary(multiple)).toThrow("feature-a.ts");
    expect(() => checkModuleBoundary(multiple)).toThrow("feature-b.ts");
  });

  it("checks #root imports outside tests", () => {
    const allowed = makeTmpProject();
    mkdirSync(join(allowed, "src/core/loop"), { recursive: true });
    writeFileSync(join(allowed, "src/core/loop/context.ts"), 'import { x } from "#root/init.js";\n');
    expect(checkModuleBoundary(allowed)).toBe("OK: no root helper drift detected");

    const disallowed = makeTmpProject();
    mkdirSync(join(disallowed, "src/core/loop"), { recursive: true });
    writeFileSync(`${disallowed}/src/core/loop/context.ts`, 'import { x } from "#root/new-helper.js";\n');
    expect(() => checkModuleBoundary(disallowed)).toThrow(/Disallowed #root\/\* imports/);
    expect(() => checkModuleBoundary(disallowed)).toThrow("#root/new-helper.js");
    expect(() => checkModuleBoundary(disallowed)).toThrow("core/loop/context.ts");

    const testImport = makeTmpProject();
    mkdirSync(join(testImport, "src/core/tools"), { recursive: true });
    writeFileSync(`${testImport}/src/core/tools/runner.test.ts`, 'import { x } from "#root/new-helper.js";\n');
    expect(checkModuleBoundary(testImport)).toBe("OK: no root helper drift detected");
  });

  it("detects file drift before import drift and tracks the allowlist", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/stray-helper.ts"), "export const x = 1;");
    expect(() => checkModuleBoundary(dir)).toThrow(/Unexpected production files/);
    expect(() => checkModuleBoundary(dir)).toThrow("stray-helper.ts");

    expect(ROOT_ENTRYPOINT_SOURCES.has("cli.ts")).toBe(true);
    expect(ROOT_ENTRYPOINT_SOURCES.has("init.ts")).toBe(true);
    expect(ROOT_ENTRYPOINT_SOURCES.has("module-api.ts")).toBe(true);
    expect(ROOT_ENTRYPOINT_SOURCES.has("validate-queue.ts")).toBe(true);
  });
});
