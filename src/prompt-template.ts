/**
 * Prompt Template — load, render, and manage markdown prompt files with YAML front matter.
 *
 * Prompt files live in `.kota/prompts/` as `.md` files:
 * ```
 * ---
 * name: code-review
 * description: Detailed code review prompt
 * variables: [language, focus_areas]
 * tags: [code, review]
 * ---
 * You are reviewing {{language}} code. Focus on: {{focus_areas}}.
 * ```
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	parseFlatFrontMatter,
	serializeFlatFrontMatter,
} from "./frontmatter.js";

// --- Types ---

export interface PromptTemplateMeta {
	name: string;
	description?: string;
	variables?: string[];
	tags?: string[];
}

export interface PromptTemplate extends PromptTemplateMeta {
	body: string;
	filePath: string;
}

// --- Front matter parsing (local, minimal, no deps) ---

export function parseFrontMatter(raw: string): {
	attrs: Record<string, string | string[]>;
	body: string;
} {
	return parseFlatFrontMatter(raw);
}

export function serializeFrontMatter(
	attrs: Record<string, string | string[]>,
	body: string,
): string {
	return serializeFlatFrontMatter(attrs, body);
}

// --- Template rendering ---

/** Replace `{{var}}` placeholders in body with values from vars map. */
export function renderTemplate(
	body: string,
	vars: Record<string, string>,
): string {
	return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
		return key in vars ? vars[key] : match;
	});
}

/** Extract all `{{var}}` placeholder names from a template body. */
export function extractVariables(body: string): string[] {
	const vars = new Set<string>();
	for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
		vars.add(m[1]);
	}
	return [...vars];
}

// --- PromptStore ---

function parseTemplate(filePath: string, raw: string): PromptTemplate | null {
	const { attrs, body } = parseFrontMatter(raw);
	const name = (attrs.name as string) || "";
	if (!name) return null;
	return {
		name,
		description: (attrs.description as string) || undefined,
		variables: Array.isArray(attrs.variables)
			? attrs.variables
			: attrs.variables
				? [attrs.variables as string]
				: extractVariables(body),
		tags: Array.isArray(attrs.tags)
			? attrs.tags
			: attrs.tags
				? [attrs.tags as string]
				: undefined,
		body: body.trim(),
		filePath,
	};
}

export class PromptStore {
	private templates = new Map<string, PromptTemplate>();
	private readonly dir: string;

	constructor(baseDir: string) {
		this.dir = resolve(baseDir, ".kota", "prompts");
	}

	/** Scan prompts directory and load all .md files. Returns count loaded. */
	discover(): number {
		this.templates.clear();
		if (!existsSync(this.dir)) return 0;

		const files = readdirSync(this.dir).filter((f) => f.endsWith(".md"));
		for (const file of files) {
			const filePath = join(this.dir, file);
			const raw = readFileSync(filePath, "utf-8");
			const tpl = parseTemplate(filePath, raw);
			if (tpl) this.templates.set(tpl.name, tpl);
		}
		return this.templates.size;
	}

	/** Get a prompt template by name. */
	get(name: string): PromptTemplate | undefined {
		return this.templates.get(name);
	}

	/** List all loaded templates (name + description). */
	list(): PromptTemplateMeta[] {
		return [...this.templates.values()].map(({ name, description, variables, tags }) => ({
			name,
			description,
			variables,
			tags,
		}));
	}

	/** Render a template with variable substitution. */
	render(
		name: string,
		vars: Record<string, string>,
	): { content: string; missing: string[] } | null {
		const tpl = this.templates.get(name);
		if (!tpl) return null;

		const content = renderTemplate(tpl.body, vars);
		const declared = tpl.variables ?? [];
		const missing = declared.filter((v) => !(v in vars));
		return { content, missing };
	}

	/** Create a new prompt template file. Returns the file path. */
	create(meta: PromptTemplateMeta, body: string): string {
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}

		const attrs: Record<string, string | string[]> = { name: meta.name };
		if (meta.description) attrs.description = meta.description;
		if (meta.variables?.length) attrs.variables = meta.variables;
		if (meta.tags?.length) attrs.tags = meta.tags;

		const content = serializeFrontMatter(attrs, body);
		const slug = meta.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60);
		const filePath = join(this.dir, `${slug}.md`);
		writeFileSync(filePath, content, "utf-8");

		const tpl = parseTemplate(filePath, content);
		if (tpl) this.templates.set(tpl.name, tpl);
		return filePath;
	}

	/** Delete a prompt template by name. Returns true if found and deleted. */
	delete(name: string): boolean {
		const tpl = this.templates.get(name);
		if (!tpl) return false;
		unlinkSync(tpl.filePath);
		this.templates.delete(name);
		return true;
	}

	/** Number of loaded templates. */
	get size(): number {
		return this.templates.size;
	}
}
