import { isAbsolute, posix as pathPosix, relative, sep } from "node:path";
import type { OkfIssue } from "./okf-types.js";

export function extractLocalMarkdownLinks(
	body: string,
	relativePath: string,
	issues: OkfIssue[],
): string[] {
	const links = new Set<string>();
	const markdownLinkRe = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	for (const match of body.matchAll(markdownLinkRe)) {
		const target = match[1];
		if (!target || isExternalLink(target) || target.startsWith("#")) continue;
		const withoutFragment = target.split("#")[0]?.split("?")[0] ?? "";
		if (!withoutFragment || !withoutFragment.endsWith(".md")) continue;
		const conceptId = normalizeLocalLinkTarget(relativePath, withoutFragment);
		if (!conceptId || !isSafeConceptId(conceptId)) {
			issues.push({
				path: relativePath,
				message: `local markdown link escapes the bundle: ${target}`,
			});
			continue;
		}
		links.add(conceptId);
	}
	return [...links].sort();
}

export function isSafeConceptId(conceptId: string): boolean {
	if (!conceptId || conceptId.includes("\\") || isAbsolute(conceptId)) return false;
	const normalized = pathPosix.normalize(conceptId);
	if (normalized !== conceptId || normalized === "." || normalized.startsWith("../")) {
		return false;
	}
	return conceptId.split("/").every((segment) => {
		if (!segment || segment === "." || segment === "..") return false;
		const lower = `${segment}.md`.toLowerCase();
		return lower !== "index.md" && lower !== "log.md";
	});
}

export function toBundleRelativePath(root: string, fullPath: string): string {
	return relative(root, fullPath).split(sep).join("/");
}

export function isPathInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeLocalLinkTarget(sourcePath: string, target: string): string | null {
	const normalized = target.startsWith("/")
		? pathPosix.normalize(target.slice(1))
		: pathPosix.normalize(pathPosix.join(pathPosix.dirname(sourcePath), target));
	if (
		normalized.startsWith("../") ||
		normalized === ".." ||
		pathPosix.isAbsolute(normalized)
	) {
		return null;
	}
	return normalized.endsWith(".md") ? normalized.slice(0, -3) : null;
}

function isExternalLink(target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target);
}
