import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

describe("deriveDirectoryScopeId", () => {
  it("derives the same id from the same resolved path", () => {
    const id1 = deriveDirectoryScopeId("/Users/operator/projects/kota");
    const id2 = deriveDirectoryScopeId("/Users/operator/projects/kota");
    expect(id1).toBe(id2);
  });

  it("normalizes paths through path.resolve before hashing", () => {
    const absolute = resolve("/tmp/sample/project");
    const id = deriveDirectoryScopeId("/tmp/sample/project");
    const idDuplicate = deriveDirectoryScopeId(absolute);
    expect(id).toBe(idDuplicate);
  });

  it("derives different ids for different roots", () => {
    expect(deriveDirectoryScopeId("/tmp/a")).not.toBe(deriveDirectoryScopeId("/tmp/b"));
  });

  it("rejects empty roots instead of normalizing them to cwd", () => {
    expect(() => deriveDirectoryScopeId("")).toThrow(/projectDir must be a non-empty string/);
    expect(() => deriveDirectoryScopeId("   ")).toThrow(/projectDir must be a non-empty string/);
  });
});

describe("buildConfiguredProject", () => {
  it("fills displayName from basename when omitted", () => {
    const project = buildConfiguredProject({ projectDir: "/tmp/sample-project" });
    expect(project.displayName).toBe("sample-project");
    expect(project.projectDir).toBe(resolve("/tmp/sample-project"));
    expect(project.projectId).toBe(deriveDirectoryScopeId("/tmp/sample-project"));
  });

  it("trims operator-supplied displayName and falls back to basename when empty", () => {
    const trimmed = buildConfiguredProject({
      projectDir: "/tmp/p",
      displayName: "  my project  ",
    });
    expect(trimmed.displayName).toBe("my project");

    const blank = buildConfiguredProject({ projectDir: "/tmp/p", displayName: "   " });
    expect(blank.displayName).toBe("p");
  });

  it("rejects empty projectDir input", () => {
    expect(() => buildConfiguredProject({ projectDir: "" })).toThrow(
      /projectDir must be a non-empty string/,
    );
  });
});

describe("ScopeRegistry", () => {
  it("rejects an empty project list", () => {
    const stateDir = makeStateDir();
    expect(() => new ScopeRegistry({ stateDir, projects: [] })).toThrow(
      /at least one project/,
    );
  });

  it("rejects two configured inputs that resolve to the same projectId", () => {
    const stateDir = makeStateDir();
    expect(
      () =>
        new ScopeRegistry({
          stateDir,
          projects: [
            { projectDir: "/tmp/dup" },
            { projectDir: "/tmp/dup" },
          ],
        }),
    ).toThrow(/duplicate projectDir/);
  });

  it("constructs from a single project and treats it as the default", () => {
    const stateDir = makeStateDir();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir: "/tmp/solo" }],
    });
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.projectDir).toBe(resolve("/tmp/solo"));
    expect(registry.getDefault().projectDir).toBe(resolve("/tmp/solo"));
    expect(registry.getDefaultProjectId()).toBe(deriveDirectoryScopeId("/tmp/solo"));
  });

  it("supports lookup by id and by resolved directory", () => {
    const stateDir = makeStateDir();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: "/tmp/proj-a", displayName: "Alpha" },
        { projectDir: "/tmp/proj-b", displayName: "Beta" },
      ],
    });
    const alpha = registry.list()[0] as ConfiguredProject;
    const beta = registry.list()[1] as ConfiguredProject;
    expect(registry.get(alpha.projectId)).toEqual(alpha);
    expect(registry.getByDir("/tmp/proj-b")).toEqual(beta);
    expect(registry.getByDir("/tmp/missing")).toBeUndefined();
  });

  it("rejects empty directory lookups instead of normalizing them to cwd", () => {
    const stateDir = makeStateDir();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [{ projectDir: "/tmp/proj-a" }],
    });
    expect(() => registry.getByDir("")).toThrow(/projectDir must be a non-empty string/);
  });

  it("first input is the default project", () => {
    const stateDir = makeStateDir();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: "/tmp/first" },
        { projectDir: "/tmp/second" },
      ],
    });
    expect(registry.getDefault().projectDir).toBe(resolve("/tmp/first"));
  });

  it("persists a typed registry file under the state dir", () => {
    const stateDir = makeStateDir();
    new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: "/tmp/host-a", displayName: "Host A" },
        { projectDir: "/tmp/host-b", displayName: "Host B" },
      ],
    });
    const file = loadRegistryFileFromDisk(stateDir);
    expect(file).not.toBeNull();
    expect(file?.schema).toBe(1);
    expect(file?.projects).toHaveLength(2);
    expect(file?.projects[0]?.displayName).toBe("Host A");
    expect(file?.defaultProjectId).toBe(deriveDirectoryScopeId("/tmp/host-a"));

    const raw = JSON.parse(readFileSync(join(stateDir, "project-registry.json"), "utf8"));
    expect(raw.schema).toBe(1);
  });

  it("toProjection emits the typed wire shape", () => {
    const stateDir = makeStateDir();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: "/tmp/wire-a", displayName: "Wire A" },
        { projectDir: "/tmp/wire-b", displayName: "Wire B" },
      ],
    });
    const projection = registry.toProjection();
    expect(projection.defaultProjectId).toBe(deriveDirectoryScopeId("/tmp/wire-a"));
    expect(projection.projects.map((p) => p.displayName)).toEqual([
      "Wire A",
      "Wire B",
    ]);
  });

  it("toScopeProjection emits global plus directory-backed child scopes", () => {
    const stateDir = makeStateDir();
    const registry = new ScopeRegistry({
      stateDir,
      projects: [
        { projectDir: "/tmp/scope-a", displayName: "Scope A" },
        { projectDir: "/tmp/scope-b", displayName: "Scope B" },
      ],
    });
    const projection = registry.toScopeProjection();
    expect(projection.rootScopeId).toBe("global");
    expect(projection.defaultScopeId).toBe(deriveDirectoryScopeId("/tmp/scope-a"));
    expect(projection.scopes).toEqual([
      { scopeId: "global", displayName: "Global" },
      {
        scopeId: deriveDirectoryScopeId("/tmp/scope-a"),
        displayName: "Scope A",
        parentScopeId: "global",
        directoryRoot: resolve("/tmp/scope-a"),
      },
      {
        scopeId: deriveDirectoryScopeId("/tmp/scope-b"),
        displayName: "Scope B",
        parentScopeId: "global",
        directoryRoot: resolve("/tmp/scope-b"),
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
            projectId: deriveDirectoryScopeId("/tmp/x"),
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
