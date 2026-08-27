import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";

function makeScopeRoot(): string {
	const dir = join(
		tmpdir(),
		`kota-repo-tasks-default-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(join(dir, "data", "tasks", "archive"), { recursive: true });
	return dir;
}

function writeTask(
	repoRoot: string,
	id: string,
	title: string,
	state: string,
	body = "",
): void {
	const taskDir = state === "done" || state === "dropped"
		? join(repoRoot, "data", "tasks", "archive")
		: join(repoRoot, "data", "tasks");
	const file = join(taskDir, `${id}.md`);
	const fm = [
		"---",
		`status: ${state}`,
		...(state === "open" || state === "blocked" ? ["priority: p2"] : []),
		"---",
	].join("\n");
	writeFileSync(file, `${fm}\n\n# ${title}\n\n${body}\n`, "utf-8");
}

describe("RepoTasksDefaultStore (keyword fallback)", () => {
	let repoRoot: string;
	let store: RepoTasksDefaultStore;

	beforeEach(() => {
		repoRoot = makeScopeRoot();
		store = new RepoTasksDefaultStore(repoRoot);
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("ranks tasks whose title matches the query above tasks that only match in body", async () => {
		writeTask(
			repoRoot,
			"task-title-match",
			"Track spend anomaly alerts",
			"done",
			"## Problem\nUnrelated body.\n",
		);
		writeTask(
			repoRoot,
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
		writeTask(repoRoot, "task-open", "Track spend in open", "open");
		writeTask(repoRoot, "task-closed", "Track spend in closed", "done");
		const open = await store.searchTasks("spend", {
			topK: 5,
			states: ["open"],
		});
		expect(open.map((r) => r.id)).toEqual(["task-open"]);
	});

	it("returns empty array on empty query or topK 0", async () => {
		writeTask(repoRoot, "task-x", "Track spend", "open");
		expect(await store.searchTasks("", { topK: 5 })).toEqual([]);
		expect(await store.searchTasks("spend", { topK: 0 })).toEqual([]);
	});

	it("returns hits across all states by default (open + terminal)", async () => {
		writeTask(repoRoot, "task-a", "Track spend a", "open");
		writeTask(repoRoot, "task-b", "Track spend b", "done");
		writeTask(repoRoot, "task-c", "Track spend c", "dropped");
		const result = await store.searchTasks("spend", { topK: 10 });
		const ids = result.map((r) => r.id);
		expect(ids).toContain("task-a");
		expect(ids).toContain("task-b");
		expect(ids).toContain("task-c");
	});
});
