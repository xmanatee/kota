import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORTED_SKILL_PROVENANCE_FILE } from "#core/modules/imported-skills.js";
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

function writeInstalledSkill(
  projectDir: string,
  name: string,
  frontmatter: string,
  body: string,
  importedFiles = ["SKILL.md"],
): void {
  const skillDir = join(projectDir, ".kota", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}---\n${body}`);
  writeFileSync(
    join(skillDir, IMPORTED_SKILL_PROVENANCE_FILE),
    `${JSON.stringify({
      version: 1,
      skillName: name,
      source: `/source/${name}`,
      sourceKind: "single-file",
      selectedSkillPath: `/source/${name}/SKILL.md`,
      provenance: `/source/${name}`,
      importedFiles,
      skippedFiles: [],
    }, null, 2)}\n`,
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
    writeInstalledSkill(
      projectDir,
      "external",
      "name: external\ndescription: external skill\n",
      "body\n",
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
        resourceSummary: "0 resources; 0 skipped",
      }),
    );
  });

  it("listSkills reports an imported duplicate as shadowed by the module skill", () => {
    writeInstalledSkill(projectDir, "shared", "name: shared\n", "body\n");

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
    const skillDir = join(projectDir, ".kota", "skills", "invalid");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "body without frontmatter\n");

    const ctx = stubCtx(projectDir);
    expect(() => listSkills(ctx)).toThrow(
      '.kota/skills/invalid/SKILL.md: imported skills must declare frontmatter with a non-empty "name"',
    );
  });

  it("listSkills rejects imported skills that declare unsupported tool policy", () => {
    writeInstalledSkill(
      projectDir,
      "restricted",
      "name: restricted\ndisallowed-tools: [Bash]\n",
      "body\n",
    );

    const ctx = stubCtx(projectDir);
    expect(() => listSkills(ctx)).toThrow(
      '.kota/skills/restricted/SKILL.md: unsupported skill tool-policy frontmatter "disallowed-tools"',
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

  it("importSkill writes a canonical skill directory when frontmatter has a name", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "my-skill.md");
    writeFileSync(sourcePath, "---\nname: my-skill\n---\nbody\n");

    const result = await importSkill(ctx, sourcePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("my-skill");
      expect(existsSync(result.skills[0].path)).toBe(true);
      expect(result.skills[0].path).toBe(join(projectDir, ".kota", "skills", "my-skill", "SKILL.md"));
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain("name: my-skill");
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain(`imported_from: ${sourcePath}`);
      expect(existsSync(join(projectDir, ".kota", "skills", "my-skill.md"))).toBe(false);
      expect(readFileSync(
        join(projectDir, ".kota", "skills", "my-skill", IMPORTED_SKILL_PROVENANCE_FILE),
        "utf-8",
      )).toContain('"importedFiles": [');
    }
  });

  it("importSkill rejects unsupported tool-policy frontmatter before writing", async () => {
    const ctx = stubCtx(projectDir);
    const sourcePath = join(projectDir, "restricted.md");
    writeFileSync(
      sourcePath,
      "---\nname: restricted\nallowed-tools: [Read]\n---\nbody\n",
    );

    const result = await importSkill(ctx, sourcePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_skill");
      expect(result.message).toContain(
        '.kota/skills/restricted/SKILL.md: unsupported skill tool-policy frontmatter "allowed-tools"',
      );
    }
    expect(existsSync(join(projectDir, ".kota", "skills", "restricted"))).toBe(false);
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
      expect(result.skills[0].path.endsWith(join("url-skill", "SKILL.md"))).toBe(true);
      expect(readFileSync(result.skills[0].path, "utf-8")).toContain(
        "imported_from: https://example.test/my-skill.md",
      );
    }
  });

  it("imports a selected skill from a local directory pack", async () => {
    const ctx = stubCtx(projectDir);
    const packDir = join(projectDir, "pack");
    mkdirSync(join(packDir, "alpha"), { recursive: true });
    mkdirSync(join(packDir, "alpha", "references"), { recursive: true });
    mkdirSync(join(packDir, "alpha", "scripts"), { recursive: true });
    mkdirSync(join(packDir, "alpha", ".git"), { recursive: true });
    mkdirSync(join(packDir, "beta"), { recursive: true });
    writeFileSync(join(packDir, "alpha", "SKILL.md"), "Alpha guidance.\n");
    writeFileSync(join(packDir, "alpha", "references", "schema.md"), "Alpha schema.\n");
    writeFileSync(join(packDir, "alpha", "scripts", "helper.py"), "print('alpha')\n");
    writeFileSync(join(packDir, "alpha", ".git", "config"), "ignored\n");
    writeFileSync(join(packDir, "beta", "SKILL.md"), "---\nname: beta\n---\nBeta guidance.\n");
    writeFileSync(join(packDir, "beta", "sibling.md"), "Do not copy.\n");

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
      expect(existsSync(join(projectDir, ".kota", "skills", "alpha", "references", "schema.md"))).toBe(true);
      expect(existsSync(join(projectDir, ".kota", "skills", "alpha", "scripts", "helper.py"))).toBe(true);
      expect(existsSync(join(projectDir, ".kota", "skills", "alpha", "sibling.md"))).toBe(false);
      const provenance = readFileSync(
        join(projectDir, ".kota", "skills", "alpha", IMPORTED_SKILL_PROVENANCE_FILE),
        "utf-8",
      );
      expect(provenance).toContain('"references/schema.md"');
      expect(provenance).toContain('"scripts/helper.py"');
      expect(provenance).toContain(".git directory is not imported");
      expect(listSkills(ctx).skills).toContainEqual(
        expect.objectContaining({
          name: "alpha",
          sourceType: "imported",
          activation: "explicit",
          status: "resolvable",
          provenance: expect.stringContaining("directory-pack:"),
          resourceSummary: "2 resources; 1 skipped",
        }),
      );
    }
  });

});
