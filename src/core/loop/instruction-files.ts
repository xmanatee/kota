import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveScopedSearch } from "#core/util/path-scope.js";

const INSTRUCTION_FILENAMES = ["AGENTS.md", "CLAUDE.md"] as const;
type InstructionType = "AGENTS" | "CLAUDE";

const MAX_FILE_LENGTH = 8_000;
const MAX_REF_DEPTH = 3;
const REF_PATTERN = /^@(.+\.md)\s*$/gm;
const TRUNCATION_MARKER = "\n... (truncated)";

export type InstructionFile = {
	path: string;
	content: string;
	type: InstructionType;
};

function typeFromFilename(filename: string): InstructionType {
	return filename.startsWith("AGENTS") ? "AGENTS" : "CLAUDE";
}

function readInstructionFile(path: string): string {
	const raw = readFileSync(path, "utf-8").trim();
	if (raw.length <= MAX_FILE_LENGTH) return raw;
	return `${raw.slice(0, MAX_FILE_LENGTH)}${TRUNCATION_MARKER}`;
}

/**
 * Resolve `@path/to/file` references in content. Each referenced file is
 * read with the same per-file cap that applies to top-level instruction
 * files, so aggregating a root AGENTS.md with several `@docs/*.md` refs
 * cannot silently drop content from later refs.
 */
export function resolveReferences(
	content: string,
	baseDir: string,
	depth = 0,
	seen = new Set<string>(),
): string {
	if (depth >= MAX_REF_DEPTH) return content;

	return content.replace(REF_PATTERN, (_match, refPath: string) => {
		const resolved = isAbsolute(refPath)
			? refPath
			: resolve(baseDir, refPath);

		if (seen.has(resolved)) return `<!-- circular ref: ${refPath} -->`;
		if (!existsSync(resolved)) return `<!-- not found: ${refPath} -->`;

	try {
		const refContent = readInstructionFile(resolved);
		if (!refContent) return "";
		seen.add(resolved);
		return resolveReferences(
			refContent,
			dirname(resolved),
			depth + 1,
			seen,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read referenced instruction file "${refPath}": ${message}`);
	}
	});
}

/**
 * Walk up the directory tree from `startDir`, collecting AGENTS.md and CLAUDE.md files.
 * Returns root-first (outermost ancestor first) so more-specific instructions appear last.
 */
export function findInstructionFiles(
	startDir?: string,
	rootDir?: string,
): InstructionFile[] {
	const scope = resolveScopedSearch(startDir, rootDir);
	const found: InstructionFile[] = [];
	let dir = scope.startDir;

	while (true) {
		for (const filename of INSTRUCTION_FILENAMES) {
			const candidate = join(dir, filename);
			if (!existsSync(candidate)) continue;

			const raw = readInstructionFile(candidate);
			if (!raw) continue;
			const content = resolveReferences(raw, dir);
			found.push({
				path: candidate,
				content,
				type: typeFromFilename(filename),
			});
		}

		if (dir === scope.rootDir) break;

		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return found.reverse();
}

/**
 * Build an instruction context string for system prompt injection.
 * Returns empty string if no instruction files found.
 */
export function loadInstructionContext(
	startDir?: string,
	rootDir?: string,
): string {
	const files = findInstructionFiles(startDir, rootDir);
	if (files.length === 0) return "";

	const sections = files.map(
		(f) => `### ${f.type}: ${f.path}\n\n${f.content}`,
	);

	return (
		"\n\n## Project Instructions (from AGENTS.md / CLAUDE.md)\n\n" +
		sections.join("\n\n---\n\n")
	);
}
