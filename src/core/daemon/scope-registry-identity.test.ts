import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildConfiguredProject,
  deriveDirectoryScopeId,
} from "./scope-registry.js";

const paths: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0).reverse()) {
    rmSync(path, { recursive: true, force: true });
  }
});

function makeProjectDir(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `kota-scope-identity-${label}-`));
  paths.push(path);
  return path;
}

describe("deriveDirectoryScopeId", () => {
  it("derives stable ids for resolved directory roots", () => {
    const root = makeProjectDir("root");
    const alias = `${root}-alias`;
    const other = makeProjectDir("other");
    symlinkSync(root, alias, "dir");
    paths.push(alias);

    expect(deriveDirectoryScopeId(root)).toBe(deriveDirectoryScopeId(root));
    expect(deriveDirectoryScopeId(alias)).toBe(deriveDirectoryScopeId(root));
    expect(deriveDirectoryScopeId(root)).not.toBe(deriveDirectoryScopeId(other));
  });

  it("rejects empty roots instead of normalizing them to cwd", () => {
    expect(() => deriveDirectoryScopeId("")).toThrow(/projectDir must be a non-empty string/);
    expect(() => deriveDirectoryScopeId("   ")).toThrow(/projectDir must be a non-empty string/);
  });

  it("rejects roots that do not resolve to live directories", () => {
    expect(() => deriveDirectoryScopeId(join(tmpdir(), "missing-kota-scope"))).toThrow(
      /directory not found/,
    );
  });
});

describe("buildConfiguredProject", () => {
  it("fills displayName from basename when omitted", () => {
    const root = makeProjectDir("sample-project");
    const project = buildConfiguredProject({ projectDir: root });
    expect(project).toMatchObject({
      displayName: basename(root),
      projectDir: realpathSync.native(root),
      projectId: deriveDirectoryScopeId(root),
    });
  });

  it("normalizes operator-supplied display names", () => {
    const named = makeProjectDir("named");
    const unnamed = makeProjectDir("unnamed");
    expect(
      buildConfiguredProject({ projectDir: named, displayName: "  my project  " })
        .displayName,
    ).toBe("my project");
    expect(buildConfiguredProject({ projectDir: unnamed, displayName: "   " }).displayName).toBe(
      basename(unnamed),
    );
  });

  it("rejects empty projectDir input", () => {
    expect(() => buildConfiguredProject({ projectDir: "" })).toThrow(
      /projectDir must be a non-empty string/,
    );
  });
});
