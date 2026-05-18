import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SkillDef } from "#core/agents/agent-types.js";
import { parseFlatFrontMatter, splitFrontMatter } from "#core/util/frontmatter.js";

export const IMPORTED_SKILL_SOURCE = "imported";
export const IMPORTED_SKILL_ACTIVATION = "explicit";
export const IMPORTED_SKILL_PROVENANCE_FILE = "kota-import.json";

export type ImportedSkillSkippedFile = {
	path: string;
	reason: string;
};

export type ImportedSkillProvenance = {
	version: 1;
	skillName: string;
	source: string;
	sourceKind: string;
	selectedSkillPath: string;
	provenance: string;
	importedFiles: string[];
	skippedFiles: ImportedSkillSkippedFile[];
};

export type ImportedSkillRecord = {
	def: SkillDef;
	content: string;
	fileName: string;
	provenance?: string;
	resourceSummary?: string;
	importedFiles?: string[];
	skippedFiles?: ImportedSkillSkippedFile[];
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

function normalizeImportedRelativePath(promptPath: string, value: string): string {
	const normalized = value.replaceAll("\\", "/");
	if (
		!normalized ||
		normalized.startsWith("/") ||
		normalized.split("/").some((part) => part === ".." || part === "")
	) {
		fail(promptPath, `path "${value}" escapes the imported skill directory`);
	}
	return normalized;
}

function listInstalledSkillFiles(
	skillDir: string,
	promptPath: string,
	prefix = "",
): string[] {
	const files: string[] = [];
	const entries = readdirSync(skillDir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const relativePath = normalizeImportedRelativePath(
			promptPath,
			prefix ? `${prefix}/${entry.name}` : entry.name,
		);
		const fullPath = join(skillDir, entry.name);
		const stat = lstatSync(fullPath);
		if (stat.isSymbolicLink()) {
			fail(
				promptPath,
				`path "${relativePath}" is a symlink; imported skill directory contents must stay inside the skill directory`,
			);
		}
		if (entry.isDirectory()) {
			files.push(...listInstalledSkillFiles(fullPath, promptPath, relativePath));
			continue;
		}
		if (entry.isFile()) files.push(relativePath);
	}
	return files;
}

function readStringField(
	promptPath: string,
	field: string,
	value: string | undefined,
): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		fail(promptPath, `${IMPORTED_SKILL_PROVENANCE_FILE} field "${field}" must be a non-empty string`);
	}
	return value.trim();
}

function readStringArrayField(
	promptPath: string,
	field: string,
	value: string[] | undefined,
): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		fail(promptPath, `${IMPORTED_SKILL_PROVENANCE_FILE} field "${field}" must be a string array`);
	}
	return value.map((item) => normalizeImportedRelativePath(promptPath, item));
}

function readSkippedFiles(
	promptPath: string,
	value: ImportedSkillSkippedFile[] | undefined,
): ImportedSkillSkippedFile[] {
	if (!Array.isArray(value)) {
		fail(promptPath, `${IMPORTED_SKILL_PROVENANCE_FILE} field "skippedFiles" must be an array`);
	}
	return value.map((item) => {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof item.path !== "string" ||
			typeof item.reason !== "string" ||
			item.reason.trim().length === 0
		) {
			fail(
				promptPath,
				`${IMPORTED_SKILL_PROVENANCE_FILE} skippedFiles entries must include string path and reason fields`,
			);
		}
		return {
			path: normalizeImportedRelativePath(promptPath, item.path),
			reason: item.reason.trim(),
		};
	});
}

function readImportedSkillProvenance(
	skillDir: string,
	promptPath: string,
	skillName: string,
	installedFiles: ReadonlySet<string>,
): ImportedSkillProvenance {
	const provenancePath = join(skillDir, IMPORTED_SKILL_PROVENANCE_FILE);
	if (!existsSync(provenancePath)) {
		fail(
			promptPath,
			`missing ${IMPORTED_SKILL_PROVENANCE_FILE}; re-import this skill so provenance and preserved resources are auditable`,
		);
	}
	let parsed: Partial<ImportedSkillProvenance>;
	try {
		parsed = JSON.parse(readFileSync(provenancePath, "utf8")) as Partial<ImportedSkillProvenance>;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		fail(promptPath, `${IMPORTED_SKILL_PROVENANCE_FILE} is not valid JSON: ${message}`);
	}
	if (parsed.version !== 1) {
		fail(promptPath, `${IMPORTED_SKILL_PROVENANCE_FILE} field "version" must be 1`);
	}
	const metadata: ImportedSkillProvenance = {
		version: 1,
		skillName: readStringField(promptPath, "skillName", parsed.skillName),
		source: readStringField(promptPath, "source", parsed.source),
		sourceKind: readStringField(promptPath, "sourceKind", parsed.sourceKind),
		selectedSkillPath: readStringField(
			promptPath,
			"selectedSkillPath",
			parsed.selectedSkillPath,
		),
		provenance: readStringField(promptPath, "provenance", parsed.provenance),
		importedFiles: readStringArrayField(promptPath, "importedFiles", parsed.importedFiles),
		skippedFiles: readSkippedFiles(promptPath, parsed.skippedFiles),
	};
	if (metadata.skillName !== skillName) {
		fail(
			promptPath,
			`${IMPORTED_SKILL_PROVENANCE_FILE} skillName "${metadata.skillName}" must match frontmatter name "${skillName}"`,
		);
	}
	if (!metadata.importedFiles.includes("SKILL.md")) {
		fail(promptPath, `${IMPORTED_SKILL_PROVENANCE_FILE} importedFiles must include SKILL.md`);
	}
	for (const importedFile of metadata.importedFiles) {
		if (!installedFiles.has(importedFile)) {
			fail(
				promptPath,
				`${IMPORTED_SKILL_PROVENANCE_FILE} importedFiles entry "${importedFile}" is missing from the installed skill directory`,
			);
		}
	}
	return metadata;
}

function resourceSummary(metadata: ImportedSkillProvenance): string {
	const resourceCount = metadata.importedFiles.filter((file) => file !== "SKILL.md").length;
	const skippedCount = metadata.skippedFiles.length;
	return `${resourceCount} resource${resourceCount === 1 ? "" : "s"}; ${skippedCount} skipped`;
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
	const promptDirectory = fileName.includes("/") ? dirname(promptPath) : undefined;
	const content = promptDirectory
		? `### ${name}\nImported skill directory: ${promptDirectory}. Resolve bundled files relative to this directory.\n${trimmedBody}`
		: `### ${name}\n${trimmedBody}`;
	return {
		def,
		content,
		fileName,
		...(provenance !== undefined && { provenance }),
	};
}

export function readImportedSkillRecords(cwd: string): ImportedSkillRecord[] {
	const dir = importedSkillsDir(cwd);
	if (!existsSync(dir)) return [];
	const records: ImportedSkillRecord[] = [];
	const seen = new Map<string, string>();
	const entries = readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".md")) {
			fail(
				importedPromptPath(entry.name),
				`legacy flat imported skill files are no longer loaded; re-import this skill so it installs as .kota/skills/<name>/SKILL.md`,
			);
		}
		if (!entry.isDirectory()) continue;

		const skillDir = join(dir, entry.name);
		const fileName = join(entry.name, "SKILL.md");
		const promptPath = importedPromptPath(fileName);
		const skillPath = join(skillDir, "SKILL.md");
		if (!existsSync(skillPath)) {
			fail(promptPath, "directory-based imported skills must contain SKILL.md");
		}
		const installedFiles = new Set(listInstalledSkillFiles(skillDir, promptPath));
		const record = parseImportedSkillContent(readFileSync(skillPath, "utf8"), fileName);
		if (record.def.name !== entry.name) {
			fail(
				record.def.promptPath,
				`frontmatter "name" must match imported skill directory "${entry.name}"`,
			);
		}
		const metadata = readImportedSkillProvenance(
			skillDir,
			record.def.promptPath,
			record.def.name,
			installedFiles,
		);
		const previous = seen.get(record.def.name);
		if (previous) {
			fail(
				record.def.promptPath,
				`duplicate imported skill name "${record.def.name}" also declared by ${importedPromptPath(previous)}`,
			);
		}
		seen.set(record.def.name, fileName);
		records.push({
			...record,
			provenance: record.provenance ?? metadata.provenance,
			resourceSummary: resourceSummary(metadata),
			importedFiles: metadata.importedFiles,
			skippedFiles: metadata.skippedFiles,
		});
	}
	return records;
}
