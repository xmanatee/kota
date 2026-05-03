/**
 * Shared logic for `kota skill list` / `kota skill import`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ModuleContext } from "#core/modules/module-types.js";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  SkillImportOptions,
  SkillImportResult,
  SkillSummary,
  SkillsListResult,
} from "./client.js";

const IMPORTED_SOURCE_NAME = "imported";

function kotaSkillsDir(cwd: string): string {
  return join(cwd, ".kota", "skills");
}

/**
 * Read every skill file under `.kota/skills/` and surface them with the
 * `imported` source. Skills without a `name` frontmatter fall back to the
 * filename stem so each entry has a stable identifier.
 */
export function readImportedSkills(cwd: string): SkillSummary[] {
  const dir = kotaSkillsDir(cwd);
  if (!existsSync(dir)) return [];
  const results: SkillSummary[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(dir, file);
    const content = readFileSync(filePath, "utf8");
    const { attrs } = parseFlatFrontMatter(content);
    const name = typeof attrs.name === "string" ? attrs.name : basename(file, ".md");
    const description = typeof attrs.description === "string" ? attrs.description : undefined;
    results.push({
      name,
      source: IMPORTED_SOURCE_NAME,
      ...(description !== undefined && { description }),
      promptPath: join(".kota", "skills", file),
    });
  }
  return results;
}

/**
 * Combine module-contributed skills with imported skills, preferring the
 * module-contributed entry when both share a name (matches the CLI's
 * pre-migration behavior).
 */
export function listSkills(ctx: ModuleContext): SkillsListResult {
  const summaries = ctx.getModuleSummaries();
  const skills: SkillSummary[] = [];
  for (const summary of summaries) {
    for (const skill of summary.skills) {
      skills.push({
        name: skill.name,
        source: summary.name,
        ...(skill.description !== undefined && { description: skill.description }),
        promptPath: skill.promptPath,
        ...(skill.roles !== undefined && { roles: skill.roles }),
      });
    }
  }
  for (const imported of readImportedSkills(ctx.cwd)) {
    if (!skills.some((s) => s.name === imported.name)) {
      skills.push(imported);
    }
  }
  return { skills };
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

/**
 * Fetch a skill from a URL or local path and write it under
 * `.kota/skills/`. The caller may override the resolved skill name (and
 * filename); otherwise the name comes from the source's frontmatter.
 */
export async function importSkill(
  ctx: ModuleContext,
  source: string,
  options?: SkillImportOptions,
): Promise<SkillImportResult> {
  let content: string;
  try {
    content = await fetchSkillContent(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "fetch_failed", message };
  }

  const { attrs } = parseFlatFrontMatter(content);
  const frontmatterName = typeof attrs.name === "string" ? attrs.name : undefined;
  const skillName = options?.name ?? frontmatterName;
  if (!skillName) {
    return {
      ok: false,
      reason: "missing_name",
      message:
        "Skill file has no 'name' field in frontmatter. Pass an explicit name to import it.",
    };
  }

  const dir = kotaSkillsDir(ctx.cwd);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${skillName}.md`);
  writeFileSync(dest, content, "utf8");
  return { ok: true, name: skillName, path: dest };
}
