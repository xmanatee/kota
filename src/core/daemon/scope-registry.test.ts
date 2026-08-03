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
  buildConfiguredProject,
  type ConfiguredProject,
  deriveDirectoryScopeId,
  loadRegistryFileFromDisk,
  resolveConfiguredProjects,
  ScopeRegistry,
} from "./scope-registry.js";

function makeStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-project-registry-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProjectDir(name: string): string {
  return mkdtempSync(join(tmpdir(), `kota-scope-registry-${name}-`));
}

describe("ScopeRegistry", () => {
  it("rejects an empty project list", () => {
    const stateDir = makeStateDir();
    expect(() => new ScopeRegistry({ stateDir, projects: [] })).toThrow(
      /at least one project/,
    );
  });

  it("rejects two configured inputs that resolve to the same projectId", () => {
    const stateDir = makeStateDir();
    const duplicate = makeProjectDir("duplicate");
    expect(
      () =>
        new ScopeRegistry({
          stateDir,
          projects: [
            { projectDir: duplicate },
            { projectDir: duplicate },
          ],
        }),
    ).toThrow(/duplicate projectDir/);
  });

  it("constructs from a single project and treats it as the default", () => {
    const stateDir = makeStateDir();
    const projectDir = makeProjectDir("solo");
    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir }],
    });
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.projectDir).toBe(realpathSync.native(projectDir));
    expect(registry.getDefault().projectDir).toBe(realpathSync.native(projectDir));
    expect(registry.getDefaultProjectId()).toBe(deriveDirectoryScopeId(projectDir));
  });

  it("supports lookup by id and by resolved directory", () => {
    const stateDir = makeStateDir();
    const projectA = makeProjectDir("lookup-a");
    const projectB = makeProjectDir("lookup-b");
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: projectA, displayName: "Alpha" },
        { projectDir: projectB, displayName: "Beta" },
      ],
    });
    const alpha = registry.list()[0] as ConfiguredProject;
    const beta = registry.list()[1] as ConfiguredProject;
    expect(registry.get(alpha.projectId)).toEqual(alpha);
    expect(registry.getByDir(projectB)).toEqual(beta);
    expect(registry.getByDir(join(stateDir, "missing"))).toBeUndefined();
  });

  it("rejects empty directory lookups instead of normalizing them to cwd", () => {
    const stateDir = makeStateDir();
    const projectDir = makeProjectDir("empty-lookup");
    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir }],
    });
    expect(() => registry.getByDir("")).toThrow(/projectDir must be a non-empty string/);
  });

  it("first input is the default project", () => {
    const stateDir = makeStateDir();
    const first = makeProjectDir("first");
    const second = makeProjectDir("second");
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: first },
        { projectDir: second },
      ],
    });
    expect(registry.getDefault().projectDir).toBe(realpathSync.native(first));
  });

  it("persists a typed registry file under the state dir", () => {
    const stateDir = makeStateDir();
    const hostA = makeProjectDir("host-a");
    const hostB = makeProjectDir("host-b");
    new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: hostA, displayName: "Host A" },
        { projectDir: hostB, displayName: "Host B" },
      ],
    });
    const file = loadRegistryFileFromDisk(stateDir);
    expect(file).not.toBeNull();
    expect(file?.schema).toBe(1);
    expect(file?.projects).toHaveLength(2);
    expect(file?.projects[0]?.displayName).toBe("Host A");
    expect(file?.defaultProjectId).toBe(deriveDirectoryScopeId(hostA));

    const raw = JSON.parse(readFileSync(join(stateDir, "project-registry.json"), "utf8"));
    expect(raw.schema).toBe(1);
  });

  it("restores persisted mutations instead of treating later config as authority", () => {
    const stateDir = makeStateDir();
    const scopeA = makeProjectDir("authority-a");
    const scopeB = makeProjectDir("authority-b");
    const ignoredSeed = makeProjectDir("authority-ignored");
    const registry = new ScopeRegistry({ stateDir, projects: [{ projectDir: scopeA }] });
    const added = buildConfiguredProject({ projectDir: scopeB, displayName: "Scope B" });
    registry.add(added);
    registry.updateDisplayName(added.projectId, "Persisted B");
    registry.setDefault(added.projectId);

    const restored = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir: ignoredSeed }],
    });
    expect(restored.list().map((project) => project.projectDir)).toEqual([
      realpathSync.native(scopeA),
      realpathSync.native(scopeB),
    ]);
    expect(restored.getDefault()).toMatchObject({
      projectId: added.projectId,
      displayName: "Persisted B",
    });
  });

  it("toProjection emits the typed wire shape", () => {
    const stateDir = makeStateDir();
    const wireA = makeProjectDir("wire-a");
    const wireB = makeProjectDir("wire-b");
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: wireA, displayName: "Wire A" },
        { projectDir: wireB, displayName: "Wire B" },
      ],
    });
    const projection = registry.toProjection();
    expect(projection.defaultProjectId).toBe(deriveDirectoryScopeId(wireA));
    expect(projection.projects.map((p) => p.displayName)).toEqual([
      "Wire A",
      "Wire B",
    ]);
  });

  it("toScopeProjection emits global plus directory-backed child scopes", () => {
    const stateDir = makeStateDir();
    const scopeA = makeProjectDir("scope-a");
    const scopeB = makeProjectDir("scope-b");
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: scopeA, displayName: "Scope A" },
        { projectDir: scopeB, displayName: "Scope B" },
      ],
    });
    const projection = registry.toScopeProjection();
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
      join(stateDir, "project-registry.json"),
      JSON.stringify({ schema: 99, defaultProjectId: "x", projects: [] }),
    );
    expect(() => loadRegistryFileFromDisk(stateDir)).toThrow(JsonFileError);
  });

  it("rejects a defaultProjectId that does not match any registered project", () => {
    const stateDir = makeStateDir();
    writeFileSync(
      join(stateDir, "project-registry.json"),
      JSON.stringify({
        schema: 1,
        defaultProjectId: "no-such-id",
        projects: [
          {
            projectId: "scope-x",
            projectDir: resolve("/tmp/x"),
            displayName: "x",
          },
        ],
      }),
    );
    expect(() => loadRegistryFileFromDisk(stateDir)).toThrow(/does not match/);
  });
});

describe("resolveConfiguredProjects", () => {
  it("returns the explicit list when provided", () => {
    const result = resolveConfiguredProjects({
      projects: [{ projectDir: "/tmp/explicit" }],
      projectDir: "/tmp/ignored",
      fallbackProjectDir: "/tmp/fallback",
    });
    expect(result).toEqual([{ projectDir: "/tmp/explicit" }]);
  });

  it("falls back to projectDir for single-project operators", () => {
    const result = resolveConfiguredProjects({
      projectDir: "/tmp/single",
      fallbackProjectDir: "/tmp/fallback",
    });
    expect(result).toEqual([{ projectDir: "/tmp/single" }]);
  });

  it("uses the daemon-supplied fallback when neither input is set", () => {
    const result = resolveConfiguredProjects({ fallbackProjectDir: "/tmp/cwd" });
    expect(result).toEqual([{ projectDir: "/tmp/cwd" }]);
  });

  it("treats an empty projects array as 'not provided'", () => {
    const result = resolveConfiguredProjects({
      projects: [],
      projectDir: "/tmp/single",
      fallbackProjectDir: "/tmp/fallback",
    });
    expect(result).toEqual([{ projectDir: "/tmp/single" }]);
  });

  it("rejects empty DaemonConfig projectDir shorthand input", () => {
    expect(() =>
      resolveConfiguredProjects({
        projectDir: "",
        fallbackProjectDir: "/tmp/fallback",
      }),
    ).toThrow(/projectDir must be a non-empty string/);
  });

  it("rejects empty DaemonConfig projects entries", () => {
    expect(() =>
      resolveConfiguredProjects({
        projects: [{ projectDir: "" }],
        fallbackProjectDir: "/tmp/fallback",
      }),
    ).toThrow(/projects\[0\]\.projectDir must be a non-empty string/);
  });

  it("rejects empty daemon fallback input", () => {
    expect(() => resolveConfiguredProjects({ fallbackProjectDir: "" })).toThrow(
      /fallbackProjectDir must be a non-empty string/,
    );
  });
});
