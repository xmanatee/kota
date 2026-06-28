import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { splitFrontMatter } from "#core/util/frontmatter.js";
import {
	parseOkfFrontmatterBlock,
	startsWithFrontmatterDelimiter,
} from "./okf-frontmatter.js";
import {
	extractLocalMarkdownLinks,
	isPathInside,
	isSafeConceptId,
	toBundleRelativePath,
} from "./okf-paths.js";
import {
	type OkfBundle,
	OkfBundleError,
	type OkfConcept,
	type OkfIssue,
	type OkfValidationResult,
} from "./okf-types.js";

export function validateOkfBundle(bundleDir: string): OkfValidationResult {
	try {
		return { ok: true, bundle: readOkfBundle(bundleDir), errors: [] };
	} catch (err) {
		if (err instanceof OkfBundleError) {
			return { ok: false, errors: err.issues };
		}
		return {
			ok: false,
			errors: [
				{
					path: bundleDir,
					message: err instanceof Error ? err.message : String(err),
				},
			],
		};
	}
}

export function readOkfBundle(bundleDir: string): OkfBundle {
	const root = resolve(bundleDir);
	const issues: OkfIssue[] = [];
	const concepts: OkfConcept[] = [];
	const reservedFiles: string[] = [];
	let okfVersion: string | null = null;

	if (!existsSync(root)) {
		throw new OkfBundleError([
			{ path: bundleDir, message: "bundle directory does not exist" },
		]);
	}
	if (!statSync(root).isDirectory()) {
		throw new OkfBundleError([
			{ path: bundleDir, message: "bundle path is not a directory" },
		]);
	}

	walkOkfDirectory({
		root,
		dir: root,
		issues,
		concepts,
		reservedFiles,
		setOkfVersion: (version) => {
			okfVersion = version;
		},
	});
	issues.push(...findDuplicateConceptIds(concepts));

	if (issues.length > 0) throw new OkfBundleError(issues);
	return { root, okfVersion, concepts, reservedFiles };
}

function walkOkfDirectory(options: {
	root: string;
	dir: string;
	issues: OkfIssue[];
	concepts: OkfConcept[];
	reservedFiles: string[];
	setOkfVersion: (version: string | null) => void;
}): void {
	const entries = readdirSync(options.dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const entry of entries) {
		const fullPath = join(options.dir, entry.name);
		const relativePath = toBundleRelativePath(options.root, fullPath);
		if (entry.isSymbolicLink() || lstatSync(fullPath).isSymbolicLink()) {
			options.issues.push({
				path: relativePath,
				message: "symbolic links are not supported in OKF bundles",
			});
			continue;
		}
		if (!isPathInside(options.root, fullPath)) {
			options.issues.push({
				path: relativePath,
				message: "path escapes the OKF bundle root",
			});
			continue;
		}
		if (entry.isDirectory()) {
			walkOkfDirectory({ ...options, dir: fullPath });
			continue;
		}
		if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") {
			continue;
		}
		const lowerName = entry.name.toLowerCase();
		if (lowerName === "index.md") {
			options.reservedFiles.push(relativePath);
			const version = validateIndexFile(fullPath, relativePath, options.issues);
			if (relativePath === "index.md") options.setOkfVersion(version);
			continue;
		}
		if (lowerName === "log.md") {
			options.reservedFiles.push(relativePath);
			validateLogFile(fullPath, relativePath, options.issues);
			continue;
		}
		const concept = parseConceptFile(
			options.root,
			fullPath,
			relativePath,
			options.issues,
		);
		if (concept) options.concepts.push(concept);
	}
}

function validateIndexFile(
	fullPath: string,
	relativePath: string,
	issues: OkfIssue[],
): string | null {
	const raw = readFileSync(fullPath, "utf-8");
	const split = splitFrontMatter(raw);
	if (!split) {
		if (startsWithFrontmatterDelimiter(raw)) {
			issues.push({ path: relativePath, message: "malformed index.md frontmatter" });
		}
		return null;
	}
	if (relativePath !== "index.md") {
		issues.push({
			path: relativePath,
			message: "index.md frontmatter is only supported at the bundle root for okf_version",
		});
		return null;
	}
	const parsed = parseOkfFrontmatterBlock(split.frontmatter, relativePath);
	issues.push(...parsed.issues);
	for (const key of Object.keys(parsed.attrs)) {
		if (key !== "okf_version") {
			issues.push({
				path: relativePath,
				message: `unsupported root index.md frontmatter field "${key}"`,
			});
		}
	}
	if (parsed.complexFields.length > 0) {
		issues.push({
			path: relativePath,
			message: "root index.md okf_version frontmatter must be scalar",
		});
	}
	const version = parsed.attrs.okf_version;
	return typeof version === "string" && version.trim() ? version : null;
}

function validateLogFile(
	fullPath: string,
	relativePath: string,
	issues: OkfIssue[],
): void {
	const raw = readFileSync(fullPath, "utf-8");
	if (splitFrontMatter(raw) || startsWithFrontmatterDelimiter(raw)) {
		issues.push({ path: relativePath, message: "log.md must not contain frontmatter" });
		return;
	}
	for (const [index, line] of raw.split(/\r?\n/).entries()) {
		if (line.startsWith("## ") && !/^## \d{4}-\d{2}-\d{2}(?:\s|$)/.test(line)) {
			issues.push({
				path: relativePath,
				message: `log.md date heading on line ${index + 1} must use YYYY-MM-DD`,
			});
		}
	}
}

function parseConceptFile(
	root: string,
	fullPath: string,
	relativePath: string,
	issues: OkfIssue[],
): OkfConcept | null {
	const raw = readFileSync(fullPath, "utf-8");
	const split = splitFrontMatter(raw);
	if (!split) {
		issues.push({
			path: relativePath,
			message: "concept document must start with parseable YAML frontmatter",
		});
		return null;
	}
	const parsed = parseOkfFrontmatterBlock(split.frontmatter, relativePath);
	issues.push(...parsed.issues);
	const type = parsed.attrs.type;
	if (typeof type !== "string" || !type.trim()) {
		issues.push({ path: relativePath, message: 'concept frontmatter requires non-empty "type"' });
	}
	const conceptId = relativePath.slice(0, -3);
	const localLinks = extractLocalMarkdownLinks(split.body, relativePath, issues);
	if (parsed.issues.length > 0 || typeof type !== "string" || !type.trim()) {
		return null;
	}
	if (!isSafeConceptId(conceptId)) {
		issues.push({ path: relativePath, message: "concept path is not a safe OKF concept id" });
		return null;
	}
	return {
		conceptId,
		relativePath: toBundleRelativePath(root, fullPath),
		frontmatter: parsed.attrs,
		complexFields: parsed.complexFields,
		body: split.body,
		localLinks,
	};
}

function findDuplicateConceptIds(concepts: OkfConcept[]): OkfIssue[] {
	const seen = new Map<string, string>();
	const issues: OkfIssue[] = [];
	for (const concept of concepts) {
		const key = concept.conceptId.toLowerCase();
		const existing = seen.get(key);
		if (existing) {
			issues.push({
				path: concept.relativePath,
				message: `duplicate concept id collides with ${existing}`,
			});
			continue;
		}
		seen.set(key, concept.relativePath);
	}
	return issues;
}
