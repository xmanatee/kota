import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlatFrontMatter } from "./frontmatter.js";

const ROOT = process.cwd();
const TASK_ROOT = join(ROOT, "tasks");
const STATE_DIRS = [
	"inbox",
	"backlog",
	"ready",
	"doing",
	"blocked",
	"done",
	"dropped",
] as const;
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
	it("uses tasks as the single live work queue", () => {
		expect(existsSync(TASK_ROOT)).toBe(true);
		expect(existsSync(join(ROOT, "NOTES.md"))).toBe(false);
		expect(existsSync(join(ROOT, "docs", "TODO.md"))).toBe(false);
		expect(existsSync(join(ROOT, "docs", "archive"))).toBe(false);
		expect(existsSync(join(ROOT, "plans"))).toBe(false);
		expect(existsSync(join(ROOT, "tasks", "archive"))).toBe(false);
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

	it("keeps AGENTS.md in every task state directory", () => {
		for (const state of STATE_DIRS) {
			expect(existsSync(join(TASK_ROOT, state, "AGENTS.md"))).toBe(true);
		}
	});

	it("keeps task files strict and state-aligned", () => {
		for (const state of STATE_DIRS) {
			for (const file of listTaskFiles(state)) {
				const raw = readFileSync(file, "utf-8").trim();

				if (state === "inbox") {
					expect(basename(file, ".md")).toMatch(/^task-[a-z0-9-]+$/);
					expect(raw.length).toBeGreaterThan(0);

					if (raw.startsWith("---\n")) {
						const { attrs } = parseFlatFrontMatter(raw);
						if (attrs.id !== undefined) {
							expect(String(attrs.id)).toBe(basename(file, ".md"));
						}
						if (attrs.priority !== undefined) {
							expect(["p0", "p1", "p2", "p3"]).toContain(
								String(attrs.priority),
							);
						}
						if (attrs.summary !== undefined) {
							expect(String(attrs.summary)).not.toContain("\n");
						}
					}
				} else {
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
		}
	});
});
