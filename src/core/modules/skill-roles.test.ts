import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule } from "./module-types.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-skill-roles-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkillFile(dir: string, name: string): string {
  const relPath = `${name}.md`;
  writeFileSync(join(dir, relPath), `Guidance for ${name}.`);
  return relPath;
}

describe("skill role filtering", () => {
  let tmpDir: string;
  let loader: ModuleLoader;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    loader = new ModuleLoader({});
    loader.setCwd(tmpDir);
  });

  afterEach(() => {
    const { rmSync } = require("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeModule(name: string, skills: { name: string; promptPath: string; roles?: string[] }[]): KotaModule {
    return {
      name,
      version: "1.0.0",
      skills,
    };
  }

  it("skills without roles are available to all agents", async () => {
    const path = writeSkillFile(tmpDir, "universal");
    await loader.load(makeModule("m1", [{ name: "universal", promptPath: path }]));

    const prompt = loader.getSkillsPromptFor("all", "builder");
    expect(prompt).toContain("universal");

    const prompt2 = loader.getSkillsPromptFor("all", "explorer");
    expect(prompt2).toContain("universal");

    const promptNoAgent = loader.getSkillsPromptFor("all");
    expect(promptNoAgent).toContain("universal");
  });

  it("skills with roles are filtered by agent name", async () => {
    const path = writeSkillFile(tmpDir, "builder-only");
    await loader.load(makeModule("m1", [{ name: "builder-only", promptPath: path, roles: ["builder"] }]));

    const builderPrompt = loader.getSkillsPromptFor("all", "builder");
    expect(builderPrompt).toContain("builder-only");

    const explorerPrompt = loader.getSkillsPromptFor("all", "explorer");
    expect(explorerPrompt).not.toContain("builder-only");
  });

  it("skills with roles are excluded when no agent name is provided", async () => {
    const path = writeSkillFile(tmpDir, "scoped");
    await loader.load(makeModule("m1", [{ name: "scoped", promptPath: path, roles: ["builder"] }]));

    const prompt = loader.getSkillsPromptFor("all");
    expect(prompt).not.toContain("scoped");
  });

  it("multiple roles allow multiple agents", async () => {
    const path = writeSkillFile(tmpDir, "multi");
    await loader.load(makeModule("m1", [{ name: "multi", promptPath: path, roles: ["builder", "improver"] }]));

    expect(loader.getSkillsPromptFor("all", "builder")).toContain("multi");
    expect(loader.getSkillsPromptFor("all", "improver")).toContain("multi");
    expect(loader.getSkillsPromptFor("all", "explorer")).not.toContain("multi");
  });

  it("explicit skill list is also filtered by roles", async () => {
    const path = writeSkillFile(tmpDir, "scoped");
    await loader.load(makeModule("m1", [{ name: "scoped", promptPath: path, roles: ["builder"] }]));

    expect(loader.getSkillsPromptFor(["scoped"], "builder")).toContain("scoped");
    expect(loader.getSkillsPromptFor(["scoped"], "explorer")).not.toContain("scoped");
  });

  it("mixed scoped and universal skills filter correctly", async () => {
    const uniPath = writeSkillFile(tmpDir, "universal");
    const scopedPath = writeSkillFile(tmpDir, "scoped");
    await loader.load(makeModule("m1", [
      { name: "universal", promptPath: uniPath },
      { name: "scoped", promptPath: scopedPath, roles: ["builder"] },
    ]));

    const builderPrompt = loader.getSkillsPromptFor("all", "builder");
    expect(builderPrompt).toContain("universal");
    expect(builderPrompt).toContain("scoped");

    const explorerPrompt = loader.getSkillsPromptFor("all", "explorer");
    expect(explorerPrompt).toContain("universal");
    expect(explorerPrompt).not.toContain("scoped");
  });

  it("empty roles array means universal availability", async () => {
    const path = writeSkillFile(tmpDir, "empty-roles");
    await loader.load(makeModule("m1", [{ name: "empty-roles", promptPath: path, roles: [] }]));

    expect(loader.getSkillsPromptFor("all", "builder")).toContain("empty-roles");
    expect(loader.getSkillsPromptFor("all", "explorer")).toContain("empty-roles");
  });
});
