import {
	findFlatFrontMatterSeparator,
	isFlatFrontMatterKey,
} from "#core/util/frontmatter.js";
import type { OkfFrontmatterValue, OkfIssue } from "./okf-types.js";

export type ParsedOkfFrontmatter = {
	attrs: Record<string, OkfFrontmatterValue>;
	complexFields: string[];
	issues: OkfIssue[];
};

type PendingBlockField = {
	key: string;
	lines: BlockValueLine[];
};

type BlockValueLine = {
	text: string;
	lineNumber: number;
};

type ParsedValue =
	| { kind: "value"; value: OkfFrontmatterValue }
	| { kind: "complex" }
	| { kind: "invalid" };

type ParsedScalarValue =
	| { kind: "value"; value: string }
	| { kind: "invalid" };

export function parseOkfFrontmatterBlock(
	frontmatter: string,
	relativePath: string,
): ParsedOkfFrontmatter {
	const attrs: Record<string, OkfFrontmatterValue> = {};
	const complexFields: string[] = [];
	const issues: OkfIssue[] = [];
	let pending: PendingBlockField | null = null;
	const seenKeys = new Set<string>();

	function finishPending(): void {
		if (!pending) return;
		const parsed = parseBlockValue(pending.lines, relativePath, issues);
		if (parsed.kind === "value") {
			attrs[pending.key] = parsed.value;
		} else if (parsed.kind === "complex") {
			complexFields.push(pending.key);
		}
		pending = null;
	}

	const lines = frontmatter.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const lineText = lines[i] ?? "";
		const trimmed = lineText.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		if (
			pending &&
			(lineText.startsWith(" ") ||
				lineText.startsWith("\t") ||
				trimmed.startsWith("- "))
		) {
			pending.lines.push({ text: trimmed, lineNumber: i + 1 });
			continue;
		}
		if (
			!pending &&
			(lineText.startsWith(" ") ||
				lineText.startsWith("\t") ||
				trimmed.startsWith("- "))
		) {
			issues.push({
				path: relativePath,
				message: `malformed frontmatter line ${i + 1}`,
			});
			continue;
		}
		finishPending();

		const colonIdx = findFlatFrontMatterSeparator(lineText);
		if (colonIdx < 1) {
			issues.push({
				path: relativePath,
				message: `malformed frontmatter line ${i + 1}`,
			});
			continue;
		}
		const key = lineText.slice(0, colonIdx).trim();
		if (!isFlatFrontMatterKey(key)) {
			issues.push({
				path: relativePath,
				message: `unsupported frontmatter key "${key}" on line ${i + 1}`,
			});
			continue;
		}
		if (seenKeys.has(key)) {
			issues.push({
				path: relativePath,
				message: `duplicate frontmatter key "${key}"`,
			});
			continue;
		}
		seenKeys.add(key);
		const rawValue = lineText.slice(colonIdx + 1).trim();
		if (!rawValue) {
			pending = { key, lines: [] };
			continue;
		}
		const parsed = parseInlineValue(rawValue, relativePath, i + 1, issues);
		if (parsed.kind === "value") {
			attrs[key] = parsed.value;
		} else if (parsed.kind === "complex") {
			complexFields.push(key);
		}
	}
	finishPending();
	return { attrs, complexFields, issues };
}

function parseInlineValue(
	rawValue: string,
	relativePath: string,
	lineNumber: number,
	issues: OkfIssue[],
): ParsedValue {
	if (rawValue.startsWith("[") || rawValue.endsWith("]")) {
		if (!rawValue.startsWith("[") || !rawValue.endsWith("]")) {
			issues.push({
				path: relativePath,
				message: `malformed frontmatter inline array on line ${lineNumber}`,
			});
			return { kind: "invalid" };
		}
		const parsed = parseInlineArray(rawValue, relativePath, lineNumber, issues);
		return parsed ? { kind: "value", value: parsed } : { kind: "invalid" };
	}
	if (rawValue.startsWith("{") || rawValue.endsWith("}")) {
		if (!rawValue.startsWith("{") || !rawValue.endsWith("}")) {
			issues.push({
				path: relativePath,
				message: `malformed frontmatter inline object on line ${lineNumber}`,
			});
			return { kind: "invalid" };
		}
		return { kind: "complex" };
	}
	return parseScalarValue(rawValue, relativePath, lineNumber, issues);
}

function parseBlockValue(
	lines: BlockValueLine[],
	relativePath: string,
	issues: OkfIssue[],
): ParsedValue {
	if (lines.length === 0) return { kind: "value", value: "" };
	if (lines.every((line) => line.text.startsWith("- "))) {
		const values: string[] = [];
		let valid = true;
		for (const line of lines) {
			const parsed = parseScalarValue(
				line.text.slice(2).trim(),
				relativePath,
				line.lineNumber,
				issues,
			);
			if (parsed.kind !== "value") {
				valid = false;
				continue;
			}
			values.push(parsed.value);
		}
		return valid ? { kind: "value", value: values } : { kind: "invalid" };
	}
	return { kind: "complex" };
}

function parseInlineArray(
	rawValue: string,
	relativePath: string,
	lineNumber: number,
	issues: OkfIssue[],
): string[] | null {
	const inner = rawValue.slice(1, -1).trim();
	if (!inner) return [];
	const tokens: string[] = [];
	let token = "";
	let quote: '"' | "'" | null = null;
	for (const char of inner) {
		if (quote) {
			token += char;
			if (char === quote) quote = null;
			continue;
		}
		if ((char === '"' || char === "'") && token.trim().length === 0) {
			quote = char;
			token += char;
			continue;
		}
		if (char === ",") {
			tokens.push(token.trim());
			token = "";
			continue;
		}
		token += char;
	}
	if (quote) {
		issues.push({
			path: relativePath,
			message: `malformed frontmatter quoted scalar on line ${lineNumber}`,
		});
		return null;
	}
	tokens.push(token.trim());

	const values: string[] = [];
	for (const item of tokens) {
		if (!item) continue;
		const parsed = parseScalarValue(item, relativePath, lineNumber, issues);
		if (parsed.kind !== "value") return null;
		values.push(parsed.value);
	}
	return values;
}

function parseScalarValue(
	value: string,
	relativePath: string,
	lineNumber: number,
	issues: OkfIssue[],
): ParsedScalarValue {
	const startsQuoted = value.startsWith('"') || value.startsWith("'");
	const endsQuoted = value.endsWith('"') || value.endsWith("'");
	if (startsQuoted || endsQuoted) {
		const quote = value[0];
		if (
			value.length < 2 ||
			(quote !== '"' && quote !== "'") ||
			!value.endsWith(quote)
		) {
			issues.push({
				path: relativePath,
				message: `malformed frontmatter quoted scalar on line ${lineNumber}`,
			});
			return { kind: "invalid" };
		}
		return { kind: "value", value: value.slice(1, -1) };
	}
	return { kind: "value", value };
}

export function startsWithFrontmatterDelimiter(raw: string): boolean {
	return raw.startsWith("---\n") || raw.startsWith("---\r\n");
}
