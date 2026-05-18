import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillDef } from "#core/agents/agent-types.js";
import { parseFlatFrontMatter, splitFrontMatter } from "#core/util/frontmatter.js";

export const IMPORTED_SKILL_SOURCE = "imported";
export const IMPORTED_SKILL_ACTIVATION = "explicit";

export type ImportedSkillRecord = {
	def: SkillDef;
	content: string;
	fileName: string;
	provenance?: string;
};

export function importedSkillsDir(cwd: string): string {
	return join(cwd, ".kota", "skills");
}

function importedPromptPath(fileName: string): string {
	return join(".kota", "skills", fileName);
}

function fail(promptPath: string, message: string): never {
	throw new Error(`${promptPath}: ${message}`);
}

function readOptionalString(
	promptPath: string,
	key: string,
	value: string | string[] | undefined,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		fail(promptPath, `frontmatter "${key}" must be a string`);
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readRoles(
	promptPath: string,
	value: string | string[] | undefined,
): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		fail(promptPath, 'frontmatter "roles" must be an inline array like [builder, improver]');
	}
	const roles = value.map((role) => role.trim()).filter(Boolean);
	if (roles.length !== value.length) {
		fail(promptPath, 'frontmatter "roles" must not contain empty entries');
	}
	return roles;
}

function assertSkillName(promptPath: string, name: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
		fail(
			promptPath,
			'frontmatter "name" must use only letters, numbers, ".", "_", and "-"',
		);
	}
}

export function parseImportedSkillContent(
	raw: string,
	fileName: string,
): ImportedSkillRecord {
	const promptPath = importedPromptPath(fileName);
	if (!splitFrontMatter(raw)) {
		fail(promptPath, 'imported skills must declare frontmatter with a non-empty "name"');
	}
	const { attrs, body } = parseFlatFrontMatter(raw);
	const name = readOptionalString(promptPath, "name", attrs.name);
	if (!name) fail(promptPath, 'frontmatter "name" is required');
	assertSkillName(promptPath, name);

	const trimmedBody = body.trim();
	if (!trimmedBody) fail(promptPath, "skill guidance body is empty");

	const description = readOptionalString(promptPath, "description", attrs.description);
	const provenance = readOptionalString(promptPath, "imported_from", attrs.imported_from);
	const roles = readRoles(promptPath, attrs.roles);
	const def: SkillDef = {
		name,
		...(description !== undefined && { description }),
		promptPath,
		...(roles !== undefined && { roles }),
	};
	return {
		def,
		content: `### ${name}\n${trimmedBody}`,
		fileName,
		...(provenance !== undefined && { provenance }),
	};
}

export function readImportedSkillRecords(cwd: string): ImportedSkillRecord[] {
	const dir = importedSkillsDir(cwd);
	if (!existsSync(dir)) return [];
	const records: ImportedSkillRecord[] = [];
	const seen = new Map<string, string>();
	for (const fileName of readdirSync(dir).sort()) {
		if (!fileName.endsWith(".md")) continue;
		const record = parseImportedSkillContent(
			readFileSync(join(dir, fileName), "utf8"),
			fileName,
		);
		const previous = seen.get(record.def.name);
		if (previous) {
			fail(
				record.def.promptPath,
				`duplicate imported skill name "${record.def.name}" also declared by ${importedPromptPath(previous)}`,
			);
		}
		seen.set(record.def.name, fileName);
		records.push(record);
	}
	return records;
}
