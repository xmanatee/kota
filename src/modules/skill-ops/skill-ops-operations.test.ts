import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import { importSkill, listSkills } from "./skill-ops-operations.js";

function moduleSummary(name: string, skills: ModuleSummary["skills"]): ModuleSummary {
  return {
    name,
    source: "project",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: skills.map((s) => s.name),
    agentNames: [],
    agents: [],
    skills,
    commandNames: [],
    routeSummaries: [],
  };
}

function stubCtx(cwd: string, summaries: ModuleSummary[] = []): ModuleContext {
  return {
    cwd,
    config: {},
    getModuleSummaries: () => summaries,
  } as unknown as ModuleContext;
}

describe("skill-ops operations (local handler / daemon-down branch)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-skill-ops-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("listSkills surfaces module skills and reads imported skills", () => {
    const skillsDir = join(projectDir, ".kota", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "external.md"),
      "---\nname: external\ndescription: external skill\n---\nbody\n",
    );

    const ctx = stubCtx(projectDir, [
      moduleSummary("autonomy", [
        { name: "builder-guidance", description: "builder", promptPath: "p1.md" },
      ]),
    ]);

    const result = listSkills(ctx);
    const names = result.skills.map((s) => `${s.source}:${s.name}`);
    expect(names).toContain("autonomy:builder-guidance");
    expect(names).toContain("imported:external");
    expect(result.skills).toContainEqual(
      expect.objectContaining({
        name: "external",
        sourceType: "imported",
        status: "resolvable",
        activation: "explicit",
      }),
    );
  });

  it("listSkills reports an imported duplicate as shadowed by the module skill", () => {
    const skillsDir = join(projectDir, ".kota", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "shared.md"),
      "---\nname: shared\n---\nbody\n",
    );

    const ctx = stubCtx(projectDir, [
      moduleSummary("autonomy", [
        { name: "shared", description: "module", promptPath: "p.md" },
      ]),
    ]);

    const result = listSkills(ctx);
    expect(result.skills).toHaveLength(2);
    expect(result.skills).toContainEqual(
      expect.objectContaining({
        name: "shared",
        source: "autonomy",
        sourceType: "module",
        status: "resolvable",
      }),
    );
    expect(result.skills).toContainEqual(
      expect.objectContaining({
        name: "shared",
        source: "imported",
        sourceType: "imported",
        status: "shadowed",
        shadowedBy: "autonomy",
      }),
    );
  });

  it("listSkills fails loudly for invalid imported skill files", () => {
    const skillsDir = join(projectDir, ".kota", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "invalid.md"), "body without frontmatter\n");

    const ctx = stubCtx(projectDir);
    expect(() => listSkills(ctx)).toThrow(
      '.kota/skills/invalid.md: imported skills must declare frontmatter with a non-empty "name"',
    );
  });

  it("importSkill returns missing_name when frontmatter has no name and no override", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "no-name.md");
    writeFileSync(sourcePath, "no frontmatter here\n");

    const result = await importSkill(ctx, sourcePath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_name");
  });

  it("importSkill returns fetch_failed for a missing local file", async () => {
    const ctx = stubCtx(projectDir);
    const result = await importSkill(ctx, "/does/not/exist.md");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fetch_failed");
  });

  it("importSkill writes the file to .kota/skills/ when frontmatter has a name", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "my-skill.md");
    writeFileSync(sourcePath, "---\nname: my-skill\n---\nbody\n");

    const result = await importSkill(ctx, sourcePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("my-skill");
      expect(existsSync(result.path)).toBe(true);
      expect(readFileSync(result.path, "utf-8")).toContain("name: my-skill");
      expect(readFileSync(result.path, "utf-8")).toContain(`imported_from: ${sourcePath}`);
    }
  });

  it("covers import, list, and resolver prompt use for an imported skill", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "resolver-skill.md");
    writeFileSync(
      sourcePath,
      "---\nname: resolver-skill\ndescription: resolver fixture\n---\nUse imported resolver guidance.\n",
    );

    const imported = await importSkill(ctx, sourcePath);
    expect(imported.ok).toBe(true);

    const listed = listSkills(ctx);
    expect(listed.skills).toContainEqual(
      expect.objectContaining({
        name: "resolver-skill",
        sourceType: "imported",
        status: "resolvable",
        activation: "explicit",
        provenance: sourcePath,
      }),
    );

    const loader = new ModuleLoader({});
    loader.setCwd(projectDir);
    await loader.load({ name: "empty-module" });
    expect(loader.getSkillsPromptFor(["resolver-skill"], "builder")).toContain(
      "Use imported resolver guidance.",
    );
    expect(loader.getSkillsPromptFor("all", "builder")).not.toContain(
      "Use imported resolver guidance.",
    );
  });

  it("importSkill honors the explicit name override", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "frontmatter.md");
    writeFileSync(sourcePath, "---\nname: original\n---\nbody\n");

    const result = await importSkill(ctx, sourcePath, { name: "renamed" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("renamed");
      expect(result.path.endsWith("renamed.md")).toBe(true);
      expect(readFileSync(result.path, "utf-8")).toContain("name: renamed");
    }
  });

  it("importSkill returns invalid_skill before writing unsafe names", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "unsafe.md");
    writeFileSync(sourcePath, "---\nname: original\n---\nbody\n");

    const result = await importSkill(ctx, sourcePath, { name: "../unsafe" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_skill");
    expect(existsSync(join(projectDir, ".kota", "unsafe.md"))).toBe(false);
  });
});
