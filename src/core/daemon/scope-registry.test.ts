import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFileError } from "#core/util/json-file.js";
import {
  buildDirectoryScope,
  type DirectoryScope,
  deriveDirectoryScopeId,
  loadRegistryFileFromDisk,
  resolveConfiguredScopes,
  ScopeRegistry,
} from "./scope-registry.js";

function makeStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-scope-registry-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeScopeRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), `kota-scope-registry-${name}-`));
}

describe("ScopeRegistry", () => {
  it("rejects an empty scope list", () => {
    const stateDir = makeStateDir();
    expect(() => new ScopeRegistry({ stateDir, scopes: [] })).toThrow(
      /at least one scope/,
    );
  });

  it("rejects two configured inputs that resolve to the same scopeId", () => {
    const stateDir = makeStateDir();
    const duplicate = makeScopeRoot("duplicate");
    expect(
      () =>
        new ScopeRegistry({
          stateDir,
          scopes: [
            { scopeRoot: duplicate },
            { scopeRoot: duplicate },
          ],
        }),
    ).toThrow(/duplicate scopeRoot/);
  });

  it("constructs from a single scope and treats it as the default", () => {
    const stateDir = makeStateDir();
    const scopeRoot = makeScopeRoot("solo");
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [{ scopeRoot }],
    });
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.scopeRoot).toBe(realpathSync.native(scopeRoot));
    expect(registry.getDefault().scopeRoot).toBe(realpathSync.native(scopeRoot));
    expect(registry.getDefaultScopeId()).toBe(deriveDirectoryScopeId(scopeRoot));
  });

  it("supports lookup by id and by resolved directory", () => {
    const stateDir = makeStateDir();
    const scopeA = makeScopeRoot("lookup-a");
    const scopeB = makeScopeRoot("lookup-b");
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [
        { scopeRoot: scopeA, displayName: "Alpha" },
        { scopeRoot: scopeB, displayName: "Beta" },
      ],
    });
    const alpha = registry.list()[0] as DirectoryScope;
    const beta = registry.list()[1] as DirectoryScope;
    expect(registry.get(alpha.scopeId)).toEqual(alpha);
    expect(registry.getByRoot(scopeB)).toEqual(beta);
    expect(registry.getByRoot(join(stateDir, "missing"))).toBeUndefined();
  });

  it("rejects empty directory lookups instead of normalizing them to cwd", () => {
    const stateDir = makeStateDir();
    const scopeRoot = makeScopeRoot("empty-lookup");
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [{ scopeRoot }],
    });
    expect(() => registry.getByRoot("")).toThrow(/scopeRoot must be a non-empty string/);
  });

  it("first input is the default scope", () => {
    const stateDir = makeStateDir();
    const first = makeScopeRoot("first");
    const second = makeScopeRoot("second");
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [
        { scopeRoot: first },
        { scopeRoot: second },
      ],
    });
    expect(registry.getDefault().scopeRoot).toBe(realpathSync.native(first));
  });

  it("persists a typed registry file under the state dir", () => {
    const stateDir = makeStateDir();
    const hostA = makeScopeRoot("host-a");
    const hostB = makeScopeRoot("host-b");
    new ScopeRegistry({
      stateDir,
      scopes: [
        { scopeRoot: hostA, displayName: "Host A" },
        { scopeRoot: hostB, displayName: "Host B" },
      ],
    });
    const file = loadRegistryFileFromDisk(stateDir);
    expect(file).not.toBeNull();
    expect(file?.schema).toBe(1);
    expect(file?.scopes).toHaveLength(2);
    expect(file?.scopes[0]?.displayName).toBe("Host A");
    expect(file?.defaultScopeId).toBe(deriveDirectoryScopeId(hostA));

    const raw = JSON.parse(readFileSync(join(stateDir, "scope-registry.json"), "utf8"));
    expect(raw.schema).toBe(1);
  });

  it("restores persisted mutations instead of treating later config as authority", () => {
    const stateDir = makeStateDir();
    const scopeA = makeScopeRoot("authority-a");
    const scopeB = makeScopeRoot("authority-b");
    const ignoredSeed = makeScopeRoot("authority-ignored");
    const registry = new ScopeRegistry({ stateDir, scopes: [{ scopeRoot: scopeA }] });
    const added = buildDirectoryScope({ scopeRoot: scopeB, displayName: "Scope B" });
    registry.add(added);
    registry.updateDisplayName(added.scopeId, "Persisted B");
    registry.setDefault(added.scopeId);

    const restored = new ScopeRegistry({
      stateDir,
      scopes: [{ scopeRoot: ignoredSeed }],
    });
    expect(restored.list().map((scope) => scope.scopeRoot)).toEqual([
      realpathSync.native(scopeA),
      realpathSync.native(scopeB),
    ]);
    expect(restored.getDefault()).toMatchObject({
      scopeId: added.scopeId,
      displayName: "Persisted B",
    });
  });

  it("toProjection emits global plus directory-backed child scopes", () => {
    const stateDir = makeStateDir();
    const scopeA = makeScopeRoot("scope-a");
    const scopeB = makeScopeRoot("scope-b");
    const registry = new ScopeRegistry({
      stateDir,
      scopes: [
        { scopeRoot: scopeA, displayName: "Scope A" },
        { scopeRoot: scopeB, displayName: "Scope B" },
      ],
    });
    const projection = registry.toProjection();
    expect(projection.rootScopeId).toBe("global");
    expect(projection.defaultScopeId).toBe(deriveDirectoryScopeId(scopeA));
    expect(projection.scopes).toEqual([
      { scopeId: "global", displayName: "Global" },
      {
        scopeId: deriveDirectoryScopeId(scopeA),
        displayName: "Scope A",
        parentScopeId: "global",
        directoryRoot: realpathSync.native(scopeA),
      },
      {
        scopeId: deriveDirectoryScopeId(scopeB),
        displayName: "Scope B",
        parentScopeId: "global",
        directoryRoot: realpathSync.native(scopeB),
      },
    ]);
  });
});

describe("loadRegistryFileFromDisk", () => {
  it("returns null when the file does not exist", () => {
    const stateDir = makeStateDir();
    expect(loadRegistryFileFromDisk(stateDir)).toBeNull();
  });

  it("rejects an unsupported schema version", () => {
    const stateDir = makeStateDir();
    writeFileSync(
      join(stateDir, "scope-registry.json"),
      JSON.stringify({ schema: 99, defaultScopeId: "x", scopes: [] }),
    );
    expect(() => loadRegistryFileFromDisk(stateDir)).toThrow(JsonFileError);
  });

  it("rejects a defaultScopeId that does not match any registered scope", () => {
    const stateDir = makeStateDir();
    writeFileSync(
      join(stateDir, "scope-registry.json"),
      JSON.stringify({
        schema: 1,
        defaultScopeId: "no-such-id",
        scopes: [
          {
            scopeId: "scope-x",
            scopeRoot: resolve("/tmp/x"),
            displayName: "x",
          },
        ],
      }),
    );
    expect(() => loadRegistryFileFromDisk(stateDir)).toThrow(/does not match/);
  });
});

describe("resolveConfiguredScopes", () => {
  it("returns the explicit list when provided", () => {
    const result = resolveConfiguredScopes({
      scopes: [{ scopeRoot: "/tmp/explicit" }],
      scopeRoot: "/tmp/ignored",
      fallbackScopeRoot: "/tmp/fallback",
    });
    expect(result).toEqual([{ scopeRoot: "/tmp/explicit" }]);
  });

  it("falls back to scopeRoot for single-scope operators", () => {
    const result = resolveConfiguredScopes({
      scopeRoot: "/tmp/single",
      fallbackScopeRoot: "/tmp/fallback",
    });
    expect(result).toEqual([{ scopeRoot: "/tmp/single" }]);
  });

  it("uses the daemon-supplied fallback when neither input is set", () => {
    const result = resolveConfiguredScopes({ fallbackScopeRoot: "/tmp/cwd" });
    expect(result).toEqual([{ scopeRoot: "/tmp/cwd" }]);
  });

  it("treats an empty scopes array as 'not provided'", () => {
    const result = resolveConfiguredScopes({
      scopes: [],
      scopeRoot: "/tmp/single",
      fallbackScopeRoot: "/tmp/fallback",
    });
    expect(result).toEqual([{ scopeRoot: "/tmp/single" }]);
  });

  it("rejects empty DaemonConfig scopeRoot shorthand input", () => {
    expect(() =>
      resolveConfiguredScopes({
        scopeRoot: "",
        fallbackScopeRoot: "/tmp/fallback",
      }),
    ).toThrow(/scopeRoot must be a non-empty string/);
  });

  it("rejects empty DaemonConfig scopes entries", () => {
    expect(() =>
      resolveConfiguredScopes({
        scopes: [{ scopeRoot: "" }],
        fallbackScopeRoot: "/tmp/fallback",
      }),
    ).toThrow(/scopes\[0\]\.scopeRoot must be a non-empty string/);
  });

  it("rejects empty daemon fallback input", () => {
    expect(() => resolveConfiguredScopes({ fallbackScopeRoot: "" })).toThrow(
      /fallbackScopeRoot must be a non-empty string/,
    );
  });
});
