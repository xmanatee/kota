/**
 * Shared logic for `kota skill list` / `kota skill import`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPORTED_SKILL_ACTIVATION,
  IMPORTED_SKILL_SOURCE,
  importedSkillsDir,
  parseImportedSkillContent,
  readImportedSkillRecords,
} from "#core/modules/imported-skills.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  SkillImportOptions,
  SkillImportResult,
  SkillSummary,
  SkillsListResult,
} from "./client.js";

/**
 * Read every skill file under `.kota/skills/` and surface them with the
 * `imported` source. Invalid files throw with the concrete path and field so
 * operators do not mistake inert prompt files for active skills.
 */
export function readImportedSkills(
  cwd: string,
  moduleSkillOwners: ReadonlyMap<string, string> = new Map(),
): SkillSummary[] {
  return readImportedSkillRecords(cwd).map((record) => {
    const shadowedBy = moduleSkillOwners.get(record.def.name);
    return {
      name: record.def.name,
      source: IMPORTED_SKILL_SOURCE,
      sourceType: "imported",
      status: shadowedBy ? "shadowed" : "resolvable",
      activation: IMPORTED_SKILL_ACTIVATION,
      ...(record.def.description !== undefined && { description: record.def.description }),
      promptPath: record.def.promptPath,
      ...(record.def.roles !== undefined && { roles: record.def.roles }),
      ...(record.provenance !== undefined && { provenance: record.provenance }),
      ...(shadowedBy !== undefined && { shadowedBy }),
    };
  });
}

/**
 * Combine module-contributed skills with imported skills, preferring the
 * module-contributed entry when both share a name (matches the CLI's
 * pre-migration behavior).
 */
export function listSkills(ctx: ModuleContext): SkillsListResult {
  const summaries = ctx.getModuleSummaries();
  const skills: SkillSummary[] = [];
  const moduleSkillOwners = new Map<string, string>();
  for (const summary of summaries) {
    for (const skill of summary.skills) {
      if (!moduleSkillOwners.has(skill.name)) moduleSkillOwners.set(skill.name, summary.name);
      skills.push({
        name: skill.name,
        source: summary.name,
        sourceType: "module",
        status: "resolvable",
        activation: "default",
        ...(skill.description !== undefined && { description: skill.description }),
        promptPath: skill.promptPath,
        ...(skill.roles !== undefined && { roles: skill.roles }),
      });
    }
  }
  skills.push(...readImportedSkills(ctx.cwd, moduleSkillOwners));
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

  const { attrs, body } = parseFlatFrontMatter(content);
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

  const serialized = serializeFlatFrontMatter(
    { ...attrs, name: skillName, imported_from: source },
    body,
  );
  try {
    parseImportedSkillContent(serialized, `${skillName}.md`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "invalid_skill", message };
  }

  const dir = importedSkillsDir(ctx.cwd);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${skillName}.md`);
  writeFileSync(dest, serialized, "utf8");
  return { ok: true, name: skillName, path: dest };
}
