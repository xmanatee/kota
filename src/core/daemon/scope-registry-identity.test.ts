import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDirectoryScope,
  deriveDirectoryScopeId,
} from "./scope-registry.js";

const paths: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0).reverse()) {
    rmSync(path, { recursive: true, force: true });
  }
});

function makeScopeRoot(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `kota-scope-identity-${label}-`));
  paths.push(path);
  return path;
}

describe("deriveDirectoryScopeId", () => {
  it("derives stable ids for resolved directory roots", () => {
    const root = makeScopeRoot("root");
    const alias = `${root}-alias`;
    const other = makeScopeRoot("other");
    symlinkSync(root, alias, "dir");
    paths.push(alias);

    expect(deriveDirectoryScopeId(root)).toBe(deriveDirectoryScopeId(root));
    expect(deriveDirectoryScopeId(alias)).toBe(deriveDirectoryScopeId(root));
    expect(deriveDirectoryScopeId(root)).not.toBe(deriveDirectoryScopeId(other));
  });

  it("rejects empty roots instead of normalizing them to cwd", () => {
    expect(() => deriveDirectoryScopeId("")).toThrow(/scopeRoot must be a non-empty string/);
    expect(() => deriveDirectoryScopeId("   ")).toThrow(/scopeRoot must be a non-empty string/);
  });

  it("rejects roots that do not resolve to live directories", () => {
    expect(() => deriveDirectoryScopeId(join(tmpdir(), "missing-kota-scope"))).toThrow(
      /directory not found/,
    );
  });
});

describe("buildDirectoryScope", () => {
  it("fills displayName from basename when omitted", () => {
    const root = makeScopeRoot("sample-project");
    const scope = buildDirectoryScope({ scopeRoot: root });
    expect(scope).toMatchObject({
      displayName: basename(root),
      scopeRoot: realpathSync.native(root),
      scopeId: deriveDirectoryScopeId(root),
    });
  });

  it("normalizes operator-supplied display names", () => {
    const named = makeScopeRoot("named");
    const unnamed = makeScopeRoot("unnamed");
    expect(
      buildDirectoryScope({ scopeRoot: named, displayName: "  my project  " })
        .displayName,
    ).toBe("my project");
    expect(buildDirectoryScope({ scopeRoot: unnamed, displayName: "   " }).displayName).toBe(
      basename(unnamed),
    );
  });

  it("rejects empty scopeRoot input", () => {
    expect(() => buildDirectoryScope({ scopeRoot: "" })).toThrow(
      /scopeRoot must be a non-empty string/,
    );
  });
});
