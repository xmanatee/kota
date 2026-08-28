import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticTasksStore, tasksSidecarDir } from "./semantic-store.js";

function makeScopeRoot(): string {
	const dir = join(
		tmpdir(),
		`kota-tasks-sem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, ".kota"), { recursive: true });
	mkdirSync(join(dir, "data", "tasks"), { recursive: true });
	mkdirSync(join(dir, "data", "tasks", "archive"), { recursive: true });
	try {
		execFileSync("git", ["init", "--quiet"], { cwd: dir });
		execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir });
		execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
	} catch {
		// git not available in some test environments
	}
	return dir;
}

type TaskSpec = {
	id: string;
	title: string;
	state: string;
	priority?: string;
	body?: string;
};

function writeTask(scopeRoot: string, spec: TaskSpec): void {
	const dir = spec.state === "done" || spec.state === "dropped"
		? join(scopeRoot, "data", "tasks", "archive")
		: join(scopeRoot, "data", "tasks");
	const filePath = join(dir, `${spec.id}.md`);
	const fmLines = [
		"---",
		`status: ${spec.state}`,
		...(spec.state === "open" || spec.state === "blocked"
			? [`priority: ${spec.priority ?? "p2"}`]
			: []),
		"---",
	].join("\n");
	const body = spec.body ?? "";
	writeFileSync(filePath, `${fmLines}\n\n# ${spec.title}\n\n${body}\n`, "utf-8");
}

describe("SemanticTasksStore", () => {
	let scopeRoot: string;
	let provider: FakeEmbeddingProvider;
	let store: SemanticTasksStore;
	let errors: unknown[];

	beforeEach(() => {
		scopeRoot = makeScopeRoot();
		provider = new FakeEmbeddingProvider();
		errors = [];
		store = new SemanticTasksStore({
			scopeRoot,
			provider,
			onBackgroundError: (e) => errors.push(e),
		});
	});

	afterEach(() => {
		rmSync(scopeRoot, { recursive: true, force: true });
	});

	it("declares reindex and search capabilities only (read-only adapter)", () => {
		expect(store.capabilities).toEqual({
			mutation: false,
			deletion: false,
			reindex: true,
			search: true,
		});
	});

	it("returns scored task search hits with state and priority metadata", async () => {
		writeTask(scopeRoot, {
			id: "task-cost-anomaly",
			title: "Track spend anomaly alerts in the workflow run dashboard",
			state: "done",
			body: [
				"## Problem",
				"Operators miss spending spikes because no anomaly alert fires.",
				"## Desired Outcome",
				"A workflow surfaces unusual spend events to the operator.",
				"## Constraints",
				"## Source / Intent",
				"## Initiative",
				"",
			].join("\n"),
		});
		writeTask(scopeRoot, {
			id: "task-bread",
			title: "Document bread baking recipe",
			state: "done",
			body: "## Problem\nBaking bread at home.\n",
		});

		const result = await store.searchTasks("pipeline expense metrics", {
			topK: 3,
		});

		expect(errors).toEqual([]);
		expect(result.length).toBeGreaterThan(0);
		expect(result[0].id).toBe("task-cost-anomaly");
		expect(result[0].score).toBeGreaterThan(0);
		expect(result[0].state).toBe("done");
		expect(result[0].title).toMatch(/spend anomaly/);
	});

	it("populates the sidecar index under <scopeRoot>/.kota/tasks-semantic on reindex", async () => {
		writeTask(scopeRoot, {
			id: "task-spend",
			title: "Track spend",
			state: "open",
		});
		const result = await store.reindex();
		expect(result.indexed).toBe(1);
		expect(result.failed).toBe(0);

		const sidecarDir = tasksSidecarDir(scopeRoot);
		expect(existsSync(indexPathFor(sidecarDir))).toBe(true);

		const file = new SemanticIndexFile(indexPathFor(sidecarDir));
		const idx = file.load(provider.model);
		expect(idx.entries["task-spend"]).toBeDefined();
		expect(idx.entries["task-spend"].fingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it("lazily fills the sidecar for tasks added after reindex", async () => {
		writeTask(scopeRoot, {
			id: "task-original",
			title: "Track spend",
			state: "open",
		});
		await store.reindex();
		const sidecarDir = tasksSidecarDir(scopeRoot);
		const before = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		expect(before.entries["task-newly-created"]).toBeUndefined();

		writeTask(scopeRoot, {
			id: "task-newly-created",
			title: "Monitor budget alerts",
			state: "open",
		});

		const result = await store.searchTasks("cost tracking", { topK: 5 });
		const ids = result.map((r) => r.id);
		expect(ids).toContain("task-newly-created");

		const after = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		expect(after.entries["task-newly-created"]).toBeDefined();
	});

	it("re-embeds when canonical task fields change", async () => {
		writeTask(scopeRoot, {
			id: "task-evolving",
			title: "Document bread baking",
			state: "open",
		});
		await store.reindex();

		const sidecarDir = tasksSidecarDir(scopeRoot);
		const before = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		const fpBefore = before.entries["task-evolving"].fingerprint;

		writeTask(scopeRoot, {
			id: "task-evolving",
			title: "Track spend anomaly alerts",
			state: "open",
		});

		await store.searchTasks("cost", { topK: 3 });
		const after = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		expect(after.entries["task-evolving"].fingerprint).not.toBe(fpBefore);
	});

	it("filters candidates by states when requested", async () => {
		writeTask(scopeRoot, {
			id: "task-open-spend",
			title: "Track spend in open work",
			state: "open",
		});
		writeTask(scopeRoot, {
			id: "task-done-spend",
			title: "Track spend in finished work",
			state: "done",
		});

		const open = await store.searchTasks("cost tracking", {
			topK: 5,
			states: ["open"],
		});
		expect(open.map((r) => r.id)).toEqual(["task-open-spend"]);
	});
});
