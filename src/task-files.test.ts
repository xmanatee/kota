import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlatFrontMatter } from "./frontmatter.js";

const ROOT = process.cwd();
const DATA_ROOT = join(ROOT, "data");
const INBOX_ROOT = join(DATA_ROOT, "inbox");
const TASK_ROOT = join(DATA_ROOT, "tasks");
const STATE_DIRS = ["backlog", "ready", "doing", "blocked", "done", "dropped"] as const;
const REQUIRED_ATTRS = [
	"id",
	"title",
	"status",
	"priority",
	"area",
	"summary",
	"created_at",
	"updated_at",
] as const;
const REQUIRED_SECTIONS = [
	"## Problem",
	"## Desired Outcome",
	"## Constraints",
	"## Done When",
] as const;

function listTaskFiles(state: (typeof STATE_DIRS)[number]): string[] {
	return readdirSync(join(TASK_ROOT, state))
		.filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
		.map((name) => join(TASK_ROOT, state, name));
}

describe("repo task files", () => {
	it("uses data/ as the single live capture + work surface", () => {
		expect(existsSync(DATA_ROOT)).toBe(true);
		expect(existsSync(INBOX_ROOT)).toBe(true);
		expect(existsSync(TASK_ROOT)).toBe(true);
		expect(existsSync(join(ROOT, "NOTES.md"))).toBe(false);
		expect(existsSync(join(ROOT, "docs", "TODO.md"))).toBe(false);
		expect(existsSync(join(ROOT, "docs", "archive"))).toBe(false);
		expect(existsSync(join(ROOT, "plans"))).toBe(false);
		expect(existsSync(join(ROOT, "data", "tasks", "archive"))).toBe(false);
		expect(existsSync(join(ROOT, "CHANGELOG.md"))).toBe(false);
		expect(existsSync(join(ROOT, "CHANGELOG.archive.md"))).toBe(false);
		expect(existsSync(join(ROOT, "AUDIT.md"))).toBe(false);
		expect(existsSync(join(ROOT, "BUILDER_LESSONS.md"))).toBe(false);
		expect(existsSync(join(ROOT, "DESIGN.md"))).toBe(false);
		expect(existsSync(join(ROOT, "depth-log.md"))).toBe(false);
		expect(existsSync(join(ROOT, "metrics.csv"))).toBe(false);
		expect(existsSync(join(ROOT, "parse-log.py"))).toBe(false);
		expect(existsSync(join(ROOT, "refresh-depth-log.py"))).toBe(false);
	});

	it("keeps AGENTS.md in inbox and every normalized task state directory", () => {
		expect(existsSync(join(INBOX_ROOT, "AGENTS.md"))).toBe(true);
		for (const state of STATE_DIRS) {
			expect(existsSync(join(TASK_ROOT, state, "AGENTS.md"))).toBe(true);
		}
	});

	it("keeps inbox captures lightweight but understandable", () => {
		for (const file of readdirSync(INBOX_ROOT)
			.filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
			.map((name) => join(INBOX_ROOT, name))) {
			const raw = readFileSync(file, "utf-8").trim();
			expect(raw.length).toBeGreaterThan(0);

			if (raw.startsWith("---\n")) {
				const { attrs } = parseFlatFrontMatter(raw);
				if (attrs.id !== undefined) {
					expect(String(attrs.id)).toMatch(/^task-[a-z0-9-]+$/);
					expect(String(attrs.id)).toBe(basename(file, ".md"));
				}
				if (attrs.priority !== undefined) {
					expect(["p0", "p1", "p2", "p3"]).toContain(String(attrs.priority));
				}
				if (attrs.summary !== undefined) {
					expect(String(attrs.summary)).not.toContain("\n");
				}
			}
		}
	});

	it("keeps normalized task files strict and state-aligned", () => {
		for (const state of STATE_DIRS) {
			for (const file of listTaskFiles(state)) {
				const raw = readFileSync(file, "utf-8").trim();
				const { attrs, body } = parseFlatFrontMatter(raw);
				expect(String(attrs.id)).toMatch(/^task-[a-z0-9-]+$/);
				expect(basename(file, ".md")).toBe(String(attrs.id));
				expect(["p0", "p1", "p2", "p3"]).toContain(String(attrs.priority));
				expect(String(attrs.summary)).not.toContain("\n");

				for (const attr of REQUIRED_ATTRS) {
					expect(typeof attrs[attr]).toBe("string");
					expect(String(attrs[attr]).trim().length).toBeGreaterThan(0);
				}

				expect(String(attrs.status)).toBe(state);

				for (const section of REQUIRED_SECTIONS) {
					expect(body).toContain(section);
				}
			}
		}
	});
});
