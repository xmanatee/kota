import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = resolve(ROOT, "scripts/generate-ui-surface-bindings.mjs");

type BindingManifest = {
  canonicalInput: { path: string; rootType: string; sha256: string };
  outputs: Array<{ path: string; sha256: string }>;
};

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function runGenerator(...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

describe("generated ui.surface.v1 bindings", () => {
  it("check mode accepts every current generated artifact", () => {
    const result = runGenerator("--check");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("the manifest hashes the canonical input and every emitted binding", () => {
    const manifest = JSON.parse(readFileSync(
      resolve(ROOT, "clients/conformance/ui-surface-bindings.manifest.json"),
      "utf8",
    )) as BindingManifest;
    expect(manifest.canonicalInput.rootType).toBe("UiSurfaceBundle");
    expect(manifest.canonicalInput.sha256).toBe(hash(readFileSync(
      resolve(ROOT, manifest.canonicalInput.path),
      "utf8",
    )));
    expect(manifest.outputs.map((output) => output.path)).toEqual([
      "schema/ui-surface.schema.json",
      "clients/conformance/ui-surface.generated.ts",
      "clients/mobile/src/daemon/ui-surface.generated.ts",
      "clients/apple/Sources/KotaShared/Generated/UiSurface.generated.swift",
      "clients/conformance/ui-behavior-vectors.generated.json",
      "clients/mobile/src/__tests__/__fixtures__/ui-behavior-vectors.generated.json",
      "clients/apple/Tests/KotaSharedTests/ui-behavior-vectors.generated.json",
    ]);
    for (const output of manifest.outputs) {
      expect(output.sha256).toBe(hash(readFileSync(resolve(ROOT, output.path), "utf8")));
    }
  });

  it("check mode fails closed when an emitted binding is stale", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "kota-ui-bindings-"));
    try {
      mkdirSync(resolve(fixtureRoot, "src/core/daemon"), { recursive: true });
      cpSync(resolve(ROOT, "src/core/daemon/ui-surface.ts"), resolve(fixtureRoot, "src/core/daemon/ui-surface.ts"));
      mkdirSync(resolve(fixtureRoot, "scripts"), { recursive: true });
      cpSync(resolve(ROOT, "scripts/ui-behavior-vectors.mjs"), resolve(fixtureRoot, "scripts/ui-behavior-vectors.mjs"));
      cpSync(resolve(ROOT, "tsconfig.json"), resolve(fixtureRoot, "tsconfig.json"));
      expect(runGenerator("--root", fixtureRoot).status).toBe(0);
      expect(runGenerator("--root", fixtureRoot, "--check").status).toBe(0);

      const stalePath = resolve(fixtureRoot, "clients/conformance/ui-surface.generated.ts");
      appendFileSync(stalePath, "// stale\n");
      const stale = runGenerator("--root", fixtureRoot, "--check");
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain("clients/conformance/ui-surface.generated.ts");
    } finally {
      if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true });
    }
  });

});
