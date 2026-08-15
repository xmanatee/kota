import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { importSkill, listSkills } from "./skill-ops-operations.js";

function stubCtx(cwd: string): ModuleContext {
  return { cwd, config: {}, getModuleSummaries: () => [] } as unknown as ModuleContext;
}

function mockFetch(responses: Record<string, string>): void {
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const body = responses[url];
    return body === undefined
      ? new Response("missing", { status: 404, statusText: "Not Found" })
      : new Response(body, { status: 200, statusText: "OK" });
  }));
}

describe("skill pack imports", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-skill-pack-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(projectDir, { recursive: true, force: true });
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
          { path: "react/references/react.md", type: "blob" },
          { path: "typescript/SKILL.md", type: "blob" },
          { path: "typescript/references/api.md", type: "blob" },
          { path: "typescript/scripts/check.ts", type: "blob" },
          { path: "README.md", type: "blob" },
        ],
      }),
      "https://raw.githubusercontent.com/vercel/ai/main/typescript/SKILL.md": "TypeScript guidance.\n",
      "https://raw.githubusercontent.com/vercel/ai/main/typescript/references/api.md": "TypeScript API.\n",
      "https://raw.githubusercontent.com/vercel/ai/main/typescript/scripts/check.ts": "console.log('ts');\n",
    });

    const result = await importSkill(ctx, "vercel/ai", { skill: "typescript" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("typescript");
      const imported = readFileSync(result.skills[0].path, "utf-8");
      expect(imported).toContain("repo-pack: vercel/ai -> typescript/SKILL.md (skill: typescript)");
      expect(imported).toContain("TypeScript guidance.");
      expect(readFileSync(
        join(projectDir, ".kota", "skills", "typescript", "references", "api.md"),
        "utf-8",
      )).toBe("TypeScript API.\n");
      expect(readFileSync(
        join(projectDir, ".kota", "skills", "typescript", "scripts", "check.ts"),
        "utf-8",
      )).toBe("console.log('ts');\n");
      expect(existsSync(join(
        projectDir,
        ".kota",
        "skills",
        "typescript",
        "references",
        "react.md",
      ))).toBe(false);
      expect(result.skills[0].resourceSummary).toBe("2 resources; 0 skipped");
    }
  });

  it("imports from a full GitHub tree URL scoped to a skill directory", async () => {
    const ctx = stubCtx(projectDir);
    mockFetch({
      "https://api.github.com/repos/crewaiinc/skills/git/trees/main?recursive=1": JSON.stringify({
        tree: [
          { path: "python/SKILL.md", type: "blob" },
          { path: "python/references/python.md", type: "blob" },
          { path: "docs/SKILL.md", type: "blob" },
        ],
      }),
      "https://raw.githubusercontent.com/crewaiinc/skills/main/python/SKILL.md": "Python guidance.\n",
      "https://raw.githubusercontent.com/crewaiinc/skills/main/python/references/python.md": "Python reference.\n",
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
      expect(readFileSync(
        join(projectDir, ".kota", "skills", "python", "references", "python.md"),
        "utf-8",
      )).toBe("Python reference.\n");
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
    expect(listSkills(ctx).skills).toContainEqual(expect.objectContaining({
      name: "resolver-skill",
      sourceType: "imported",
      status: "resolvable",
      activation: "explicit",
      provenance: sourcePath,
      resourceSummary: "0 resources; 0 skipped",
    }));

    const loader = new ModuleLoader({});
    loader.setBus(new EventBus());
    loader.setCwd(projectDir);
    await loader.load({ name: "empty-module" });
    expect(loader.getSkillsPromptFor(["resolver-skill"], "builder")).toContain(
      "Imported skill directory: .kota/skills/resolver-skill",
    );
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
      expect(result.skills[0].path.endsWith(join("renamed", "SKILL.md"))).toBe(true);
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
