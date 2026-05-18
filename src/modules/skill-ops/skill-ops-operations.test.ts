import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function mockFetch(responses: Record<string, string>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const body = responses[url];
      if (body === undefined) {
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
      return new Response(body, { status: 200, statusText: "OK" });
    }),
  );
}

describe("skill-ops operations (local handler / daemon-down branch)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-skill-ops-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("my-skill");
      expect(existsSync(result.skills[0].path)).toBe(true);
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain("name: my-skill");
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain(`imported_from: ${sourcePath}`);
    }
  });

  it("keeps single-file URL imports on the frontmatter-driven path", async () => {
    const ctx = stubCtx(projectDir);
    mockFetch({
      "https://example.test/my-skill.md": "---\nname: url-skill\n---\nURL body\n",
    });

    const result = await importSkill(ctx, "https://example.test/my-skill.md");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("url-skill");
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain(
        "imported_from: https://example.test/my-skill.md",
      );
    }
  });

  it("imports a selected skill from a local directory pack", async () => {
    const ctx = stubCtx(projectDir);
    const packDir = join(projectDir, "pack");
    mkdirSync(join(packDir, "alpha"), { recursive: true });
    mkdirSync(join(packDir, "beta"), { recursive: true });
    writeFileSync(join(packDir, "alpha", "SKILL.md"), "Alpha guidance.\n");
    writeFileSync(join(packDir, "beta", "SKILL.md"), "---\nname: beta\n---\nBeta guidance.\n");

    const result = await importSkill(ctx, packDir, { skill: "alpha" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("alpha");
      const imported = readFileSync(result.skills[0].path, "utf-8");
      expect(imported).toContain("name: alpha");
      expect(imported).toContain("directory-pack:");
      expect(imported).toContain("alpha/SKILL.md");
      expect(imported).toContain("Alpha guidance.");
      expect(listSkills(ctx).skills).toContainEqual(
        expect.objectContaining({
          name: "alpha",
          sourceType: "imported",
          activation: "explicit",
          status: "resolvable",
          provenance: expect.stringContaining("directory-pack:"),
        }),
      );
    }
  });

  it("imports a direct local skill directory SKILL.md without network access", async () => {
    const ctx = stubCtx(projectDir);
    const skillDir = join(projectDir, "pack", "gamma");
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, "Gamma guidance.\n");

    const result = await importSkill(ctx, skillPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("gamma");
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain("skill-directory:");
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain("Gamma guidance.");
    }
  });

  it("fails ambiguous multi-skill directory imports with available skill names", async () => {
    const ctx = stubCtx(projectDir);
    const packDir = join(projectDir, "ambiguous-pack");
    mkdirSync(join(packDir, "one"), { recursive: true });
    mkdirSync(join(packDir, "two"), { recursive: true });
    writeFileSync(join(packDir, "one", "SKILL.md"), "One guidance.\n");
    writeFileSync(join(packDir, "two", "SKILL.md"), "Two guidance.\n");

    const result = await importSkill(ctx, packDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous_pack");
      expect(result.message).toContain("one");
      expect(result.message).toContain("two");
      expect(result.message).toContain("--skill");
      expect(result.message).toContain("--all");
    }
  });

  it("imports all skills from a local directory pack when explicitly requested", async () => {
    const ctx = stubCtx(projectDir);
    const packDir = join(projectDir, "all-pack");
    mkdirSync(join(packDir, "one"), { recursive: true });
    mkdirSync(join(packDir, "two"), { recursive: true });
    writeFileSync(join(packDir, "one", "SKILL.md"), "One guidance.\n");
    writeFileSync(join(packDir, "two", "SKILL.md"), "Two guidance.\n");

    const result = await importSkill(ctx, packDir, { all: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills.map((skill) => skill.name).sort()).toEqual(["one", "two"]);
      for (const skill of result.skills) expect(existsSync(skill.path)).toBe(true);
    }
  });

  it("returns an invalid pack diagnostic when a directory has no SKILL.md files", async () => {
    const ctx = stubCtx(projectDir);
    const packDir = join(projectDir, "empty-pack");
    mkdirSync(packDir, { recursive: true });

    const result = await importSkill(ctx, packDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_pack");
      expect(result.message).toContain("contains no SKILL.md");
    }
  });

  it("imports a selected skill from an owner/repo GitHub shorthand pack", async () => {
    const ctx = stubCtx(projectDir);
    mockFetch({
      "https://api.github.com/repos/vercel/ai": JSON.stringify({ default_branch: "main" }),
      "https://api.github.com/repos/vercel/ai/git/trees/main?recursive=1": JSON.stringify({
        tree: [
          { path: "react/SKILL.md", type: "blob" },
          { path: "typescript/SKILL.md", type: "blob" },
          { path: "README.md", type: "blob" },
        ],
      }),
      "https://raw.githubusercontent.com/vercel/ai/main/react/SKILL.md": "React guidance.\n",
      "https://raw.githubusercontent.com/vercel/ai/main/typescript/SKILL.md": "TypeScript guidance.\n",
    });

    const result = await importSkill(ctx, "vercel/ai", { skill: "typescript" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("typescript");
      const imported = readFileSync(result.skills[0].path, "utf-8");
      expect(imported).toContain("repo-pack: vercel/ai -> typescript/SKILL.md (skill: typescript)");
      expect(imported).toContain("TypeScript guidance.");
    }
  });

  it("imports from a full GitHub tree URL scoped to a skill directory", async () => {
    const ctx = stubCtx(projectDir);
    mockFetch({
      "https://api.github.com/repos/crewaiinc/skills/git/trees/main?recursive=1": JSON.stringify({
        tree: [
          { path: "python/SKILL.md", type: "blob" },
          { path: "docs/SKILL.md", type: "blob" },
        ],
      }),
      "https://raw.githubusercontent.com/crewaiinc/skills/main/python/SKILL.md": "Python guidance.\n",
    });

    const result = await importSkill(
      ctx,
      "https://github.com/crewaiinc/skills/tree/main/python",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("python");
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain(
        "repo-pack: https://github.com/crewaiinc/skills/tree/main/python -> python/SKILL.md (skill: python)",
      );
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
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("renamed");
      expect(result.skills[0].path.endsWith("renamed.md")).toBe(true);
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain("name: renamed");
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
