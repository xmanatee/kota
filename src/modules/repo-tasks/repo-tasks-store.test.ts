import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";

function makeProjectDir(): string {
	const dir = join(
		tmpdir(),
		`kota-repo-tasks-default-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	for (const state of [
		"backlog",
		"ready",
		"doing",
		"blocked",
		"done",
		"dropped",
	]) {
		mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
	}
	return dir;
}

function writeTask(
	projectDir: string,
	id: string,
	title: string,
	state: string,
	body = "",
	summary = "",
): void {
	const file = join(projectDir, "data", "tasks", state, `${id}.md`);
	const fm = [
		"---",
		`id: ${id}`,
		`title: ${title}`,
		`status: ${state}`,
		`priority: p2`,
		`area: core`,
		`summary: ${summary}`,
		`created_at: 2026-04-27T00:00:00.000Z`,
		`updated_at: 2026-04-27T00:00:00.000Z`,
		"---",
	].join("\n");
	writeFileSync(file, `${fm}\n${body}\n`, "utf-8");
}

describe("RepoTasksDefaultStore (keyword fallback)", () => {
	let projectDir: string;
	let store: RepoTasksDefaultStore;

	beforeEach(() => {
		projectDir = makeProjectDir();
		store = new RepoTasksDefaultStore(projectDir);
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("supportsSemanticSearch returns false", () => {
		expect(store.supportsSemanticSearch()).toBe(false);
	});

	it("reindex returns skipped: true without doing work", async () => {
		const result = await store.reindex();
		expect(result).toEqual({ indexed: 0, failed: 0, skipped: true });
	});

	it("ranks tasks whose title matches the query above tasks that only match in body", async () => {
		writeTask(
			projectDir,
			"task-title-match",
			"Track spend anomaly alerts",
			"done",
			"## Problem\nUnrelated body.\n",
		);
		writeTask(
			projectDir,
			"task-body-match",
			"Document bread baking",
			"done",
			"## Problem\nIncidentally mentions spend in passing.\n",
		);

		const result = await store.searchTasks("spend", { topK: 5 });
		expect(result.length).toBe(2);
		expect(result[0].id).toBe("task-title-match");
		expect(result[0].score).toBeGreaterThan(result[1].score);
	});

	it("filters by state when requested", async () => {
		writeTask(projectDir, "task-open", "Track spend in open", "ready");
		writeTask(projectDir, "task-closed", "Track spend in closed", "done");
		const open = await store.searchTasks("spend", {
			topK: 5,
			states: ["ready"],
		});
		expect(open.map((r) => r.id)).toEqual(["task-open"]);
	});

	it("returns empty array on empty query or topK 0", async () => {
		writeTask(projectDir, "task-x", "Track spend", "ready");
		expect(await store.searchTasks("", { topK: 5 })).toEqual([]);
		expect(await store.searchTasks("spend", { topK: 0 })).toEqual([]);
	});

	it("returns hits across all states by default (open + terminal)", async () => {
		writeTask(projectDir, "task-a", "Track spend a", "ready");
		writeTask(projectDir, "task-b", "Track spend b", "done");
		writeTask(projectDir, "task-c", "Track spend c", "dropped");
		const result = await store.searchTasks("spend", { topK: 10 });
		const ids = result.map((r) => r.id);
		expect(ids).toContain("task-a");
		expect(ids).toContain("task-b");
		expect(ids).toContain("task-c");
	});
});
