/**
 * Skills module — owns the `kota skill` CLI surface.
 *
 * Skills are contributed by other modules via `KotaModule.skills`.
 * This module registers the operator CLI for inspecting and managing them.
 * Imported skills are stored in `.kota/skills/` and shown in `skill list`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "commander";
import type { SkillDef } from "../../agent-types.js";
import { parseFlatFrontMatter } from "../../frontmatter.js";
import type { KotaModule, ModuleContext } from "../../module-types.js";

type ImportedSkill = SkillDef & { source: string };

function kotaSkillsDir(cwd: string): string {
  return join(cwd, ".kota", "skills");
}

function readImportedSkills(cwd: string): ImportedSkill[] {
  const dir = kotaSkillsDir(cwd);
  if (!existsSync(dir)) return [];
  const results: ImportedSkill[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(dir, file);
    const content = readFileSync(filePath, "utf8");
    const { attrs } = parseFlatFrontMatter(content);
    const name = typeof attrs["name"] === "string" ? attrs["name"] : basename(file, ".md");
    const description = typeof attrs["description"] === "string" ? attrs["description"] : undefined;
    results.push({ name, description, promptPath: join(".kota", "skills", file), source: "imported" });
  }
  return results;
}

async function fetchSkillContent(source: string): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.text();
  }
  if (!existsSync(source)) throw new Error(`File not found: ${source}`);
  return readFileSync(source, "utf8");
}

function buildSkillCommand(ctx: ModuleContext): Command {
  const skillCmd = new Command("skill").description("Manage and inspect registered skills");

  skillCmd
    .command("list")
    .description("List all registered skills with source module")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const summaries = ctx.getModuleSummaries();
      type SkillEntry = SkillDef & { source: string };
      const skills: SkillEntry[] = [];
      for (const summary of summaries) {
        for (const skill of summary.skills) {
          skills.push({ ...skill, source: summary.name });
        }
      }
      for (const imported of readImportedSkills(process.cwd())) {
        if (!skills.some((s) => s.name === imported.name)) {
          skills.push(imported);
        }
      }
      if (opts.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (skills.length === 0) {
        console.log("No skills registered.");
        return;
      }
      const nameWidth = Math.max(...skills.map((s) => s.name.length), 4);
      const srcWidth = Math.max(...skills.map((s) => s.source.length), 6);
      console.log(`${"Name".padEnd(nameWidth)}  ${"Source".padEnd(srcWidth)}  Description`);
      console.log("-".repeat(nameWidth + srcWidth + 16));
      for (const s of skills) {
        console.log(`${s.name.padEnd(nameWidth)}  ${s.source.padEnd(srcWidth)}  ${s.description ?? ""}`);
      }
    });

  skillCmd
    .command("import <source>")
    .description("Install a skill from a URL or local file path into .kota/skills/")
    .option("--name <name>", "Override the skill name (and filename)")
    .action(async (source: string, opts: { name?: string }) => {
      let content: string;
      try {
        content = await fetchSkillContent(source);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }

      const { attrs } = parseFlatFrontMatter(content);
      const frontmatterName = typeof attrs["name"] === "string" ? attrs["name"] : undefined;

      if (!frontmatterName && !opts.name) {
        console.error(
          "Error: skill file has no 'name' field in frontmatter. Use --name to specify one.",
        );
        process.exit(1);
      }

      const skillName = opts.name ?? (frontmatterName as string);
      const dir = kotaSkillsDir(process.cwd());
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `${skillName}.md`);
      writeFileSync(dest, content, "utf8");
      console.log(`Installed skill '${skillName}' → ${dest}`);
    });

  return skillCmd;
}

const skillsModule: KotaModule = {
  name: "skills",
  version: "1.0.0",
  description: "Operator CLI for inspecting and importing registered skills",
  commands: (ctx: ModuleContext) => [buildSkillCommand(ctx)],
};

export default skillsModule;
