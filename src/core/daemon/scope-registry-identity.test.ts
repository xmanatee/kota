import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildConfiguredProject,
  deriveDirectoryScopeId,
} from "./scope-registry.js";

describe("deriveDirectoryScopeId", () => {
  it("derives stable ids for resolved directory roots", () => {
    const root = "/Users/operator/projects/kota";
    expect(deriveDirectoryScopeId(root)).toBe(deriveDirectoryScopeId(root));
    expect(deriveDirectoryScopeId("/tmp/sample/project")).toBe(
      deriveDirectoryScopeId(resolve("/tmp/sample/project")),
    );
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
    expect(project).toMatchObject({
      displayName: "sample-project",
      projectDir: resolve("/tmp/sample-project"),
      projectId: deriveDirectoryScopeId("/tmp/sample-project"),
    });
  });

  it("normalizes operator-supplied display names", () => {
    expect(
      buildConfiguredProject({ projectDir: "/tmp/p", displayName: "  my project  " })
        .displayName,
    ).toBe("my project");
    expect(buildConfiguredProject({ projectDir: "/tmp/p", displayName: "   " }).displayName).toBe(
      "p",
    );
  });

  it("rejects empty projectDir input", () => {
    expect(() => buildConfiguredProject({ projectDir: "" })).toThrow(
      /projectDir must be a non-empty string/,
    );
  });
});
