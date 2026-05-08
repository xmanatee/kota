import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFileError } from "#core/util/json-file.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
  deriveProjectId,
  loadRegistryFileFromDisk,
  ProjectRegistry,
  resolveConfiguredProjects,
} from "./project-registry.js";

function makeStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-project-registry-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("deriveProjectId", () => {
  it("derives the same id from the same resolved path", () => {
    const id1 = deriveProjectId("/Users/operator/projects/kota");
    const id2 = deriveProjectId("/Users/operator/projects/kota");
    expect(id1).toBe(id2);
  });

  it("normalizes paths through path.resolve before hashing", () => {
    const absolute = resolve("/tmp/sample/project");
    const id = deriveProjectId("/tmp/sample/project");
    const idDuplicate = deriveProjectId(absolute);
    expect(id).toBe(idDuplicate);
  });

  it("derives different ids for different roots", () => {
    expect(deriveProjectId("/tmp/a")).not.toBe(deriveProjectId("/tmp/b"));
  });
});

describe("buildConfiguredProject", () => {
  it("fills displayName from basename when omitted", () => {
    const project = buildConfiguredProject({ projectDir: "/tmp/sample-project" });
    expect(project.displayName).toBe("sample-project");
    expect(project.projectDir).toBe(resolve("/tmp/sample-project"));
    expect(project.projectId).toBe(deriveProjectId("/tmp/sample-project"));
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
});

describe("ProjectRegistry", () => {
  it("rejects an empty project list", () => {
    const stateDir = makeStateDir();
    expect(() => new ProjectRegistry({ stateDir, projects: [] })).toThrow(
      /at least one project/,
    );
  });

  it("rejects two configured inputs that resolve to the same projectId", () => {
    const stateDir = makeStateDir();
    expect(
      () =>
        new ProjectRegistry({
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
    const registry = new ProjectRegistry({
      stateDir,
      projects: [{ projectDir: "/tmp/solo" }],
    });
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.projectDir).toBe(resolve("/tmp/solo"));
    expect(registry.getDefault().projectDir).toBe(resolve("/tmp/solo"));
    expect(registry.getDefaultProjectId()).toBe(deriveProjectId("/tmp/solo"));
  });

  it("supports lookup by id and by resolved directory", () => {
    const stateDir = makeStateDir();
    const registry = new ProjectRegistry({
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

  it("first input is the default project", () => {
    const stateDir = makeStateDir();
    const registry = new ProjectRegistry({
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
    new ProjectRegistry({
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
    expect(file?.defaultProjectId).toBe(deriveProjectId("/tmp/host-a"));

    const raw = JSON.parse(readFileSync(join(stateDir, "project-registry.json"), "utf8"));
    expect(raw.schema).toBe(1);
  });

  it("toProjection emits the typed wire shape", () => {
    const stateDir = makeStateDir();
    const registry = new ProjectRegistry({
      stateDir,
      projects: [
        { projectDir: "/tmp/wire-a", displayName: "Wire A" },
        { projectDir: "/tmp/wire-b", displayName: "Wire B" },
      ],
    });
    const projection = registry.toProjection();
    expect(projection.defaultProjectId).toBe(deriveProjectId("/tmp/wire-a"));
    expect(projection.projects.map((p) => p.displayName)).toEqual([
      "Wire A",
      "Wire B",
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
            projectId: deriveProjectId("/tmp/x"),
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
});
