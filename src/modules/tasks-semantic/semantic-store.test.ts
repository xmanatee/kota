import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { SemanticTasksStore, tasksSidecarDir } from "./semantic-store.js";

const CONCEPTS: Record<string, number> = {
	workflow: 0,
	pipeline: 0,
	cost: 1,
	budget: 1,
	spend: 1,
	spending: 1,
	expense: 1,
	tracking: 2,
	monitoring: 2,
	metric: 2,
	metrics: 2,
	anomaly: 3,
	alert: 3,
	bread: 4,
	baking: 4,
	recipe: 4,
	auth: 5,
	login: 5,
	session: 5,
	semantic: 6,
	embedding: 6,
	search: 6,
	ranking: 6,
};

const DIMS = 8;

function fakeEmbed(text: string): number[] {
	const vec = new Array(DIMS).fill(0);
	for (const word of text.toLowerCase().split(/[^a-z]+/)) {
		if (!word) continue;
		const dim = CONCEPTS[word];
		if (dim !== undefined) vec[dim] += 1;
	}
	return vec;
}

class FakeEmbeddingProvider implements EmbeddingProvider {
	readonly name = "fake";
	readonly model: string;
	public calls = 0;
	public failNext = false;

	constructor(model = "fake-model-v1") {
		this.model = model;
	}

	async embed(texts: string[]): Promise<number[][]> {
		this.calls += 1;
		if (this.failNext) {
			this.failNext = false;
			throw new Error("fake provider failure");
		}
		return texts.map(fakeEmbed);
	}
}

function makeProjectDir(): string {
	const dir = join(
		tmpdir(),
		`kota-tasks-sem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, ".kota"), { recursive: true });
	mkdirSync(join(dir, "data", "tasks"), { recursive: true });
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
	// Init a git repo so child operations that touch git don't blow up — though
	// the semantic store does not call git, the surrounding CLI flows do.
	try {
		execFileSync("git", ["init", "--quiet"], { cwd: dir });
		execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir });
		execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
	} catch {
		// git not available — tests below don't exercise git directly.
	}
	return dir;
}

type TaskSpec = {
	id: string;
	title: string;
	state: string;
	priority?: string;
	area?: string;
	summary?: string;
	updatedAt: string;
	body?: string;
};

function writeTask(projectDir: string, spec: TaskSpec): void {
	const filePath = join(projectDir, "data", "tasks", spec.state, `${spec.id}.md`);
	const fmLines = [
		"---",
		`id: ${spec.id}`,
		`title: ${spec.title}`,
		`status: ${spec.state}`,
		`priority: ${spec.priority ?? "p2"}`,
		`area: ${spec.area ?? "core"}`,
		`summary: ${spec.summary ?? ""}`,
		`created_at: ${spec.updatedAt}`,
		`updated_at: ${spec.updatedAt}`,
		"---",
	].join("\n");
	const body = spec.body ?? "";
	writeFileSync(filePath, `${fmLines}\n${body}\n`, "utf-8");
}

describe("SemanticTasksStore", () => {
	let projectDir: string;
	let provider: FakeEmbeddingProvider;
	let store: SemanticTasksStore;
	let errors: unknown[];

	beforeEach(() => {
		projectDir = makeProjectDir();
		provider = new FakeEmbeddingProvider();
		errors = [];
		store = new SemanticTasksStore({
			projectDir,
			provider,
			onBackgroundError: (e) => errors.push(e),
		});
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("returns the conceptually relevant task for a query whose words don't match the task body (substring would miss)", async () => {
		writeTask(projectDir, {
			id: "task-cost-anomaly",
			title: "Track spend anomaly alerts in the workflow run dashboard",
			state: "done",
			updatedAt: "2026-04-26T00:00:00.000Z",
			summary: "Surface budget alerts so operators see cost spikes early.",
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
		writeTask(projectDir, {
			id: "task-bread",
			title: "Document bread baking recipe",
			state: "done",
			updatedAt: "2026-04-26T00:00:00.000Z",
			body: "## Problem\nBaking bread at home.\n",
		});
		writeTask(projectDir, {
			id: "task-auth",
			title: "Fix auth session cookie expiry",
			state: "done",
			updatedAt: "2026-04-26T00:00:00.000Z",
			body: "## Problem\nAuth login session cookies expire too early.\n",
		});

		// Query uses synonyms — substring against the title would miss the
		// cost-anomaly task entirely (different vocabulary).
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

	it("populates the sidecar index under <projectDir>/.kota/tasks-semantic", async () => {
		writeTask(projectDir, {
			id: "task-spend",
			title: "Track spend",
			state: "ready",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});
		await store.reindex();

		const sidecarDir = tasksSidecarDir(projectDir);
		expect(existsSync(indexPathFor(sidecarDir))).toBe(true);

		const file = new SemanticIndexFile(indexPathFor(sidecarDir));
		const idx = file.load(provider.model);
		expect(idx.entries["task-spend"]).toBeDefined();
		expect(idx.entries["task-spend"].fingerprint).toBe(
			"2026-04-26T00:00:00.000Z",
		);
	});

	it("lazily fills the sidecar for tasks added after reindex", async () => {
		writeTask(projectDir, {
			id: "task-original",
			title: "Track spend",
			state: "ready",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});
		await store.reindex();
		const sidecarDir = tasksSidecarDir(projectDir);
		const before = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		expect(before.entries["task-newly-created"]).toBeUndefined();

		writeTask(projectDir, {
			id: "task-newly-created",
			title: "Monitor budget alerts",
			state: "ready",
			updatedAt: "2026-04-27T00:00:00.000Z",
		});

		// First semantic query should embed the new task on demand.
		const result = await store.searchTasks("cost tracking", { topK: 5 });
		const ids = result.map((r) => r.id);
		expect(ids).toContain("task-newly-created");

		const after = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		expect(after.entries["task-newly-created"]).toBeDefined();
	});

	it("re-embeds when a task's updated_at changes", async () => {
		writeTask(projectDir, {
			id: "task-evolving",
			title: "Document bread baking",
			state: "doing",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});
		await store.reindex();

		const sidecarDir = tasksSidecarDir(projectDir);
		const before = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		const fpBefore = before.entries["task-evolving"].fingerprint;

		writeTask(projectDir, {
			id: "task-evolving",
			title: "Track spend anomaly alerts",
			state: "doing",
			updatedAt: "2026-04-27T00:00:00.000Z",
		});

		await store.searchTasks("cost", { topK: 3 });
		const after = new SemanticIndexFile(indexPathFor(sidecarDir)).load(
			provider.model,
		);
		expect(after.entries["task-evolving"].fingerprint).not.toBe(fpBefore);
	});

	it("surfaces query-time provider errors so the namespace can map to semantic_unavailable", async () => {
		writeTask(projectDir, {
			id: "task-spend",
			title: "Track spend",
			state: "ready",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});
		provider.failNext = true;
		await expect(store.searchTasks("cost", { topK: 3 })).rejects.toThrow(
			"fake provider failure",
		);
	});

	it("filters candidates by states when requested", async () => {
		writeTask(projectDir, {
			id: "task-open-spend",
			title: "Track spend in open work",
			state: "ready",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});
		writeTask(projectDir, {
			id: "task-done-spend",
			title: "Track spend in finished work",
			state: "done",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});

		const open = await store.searchTasks("cost tracking", {
			topK: 5,
			states: ["ready"],
		});
		expect(open.map((r) => r.id)).toEqual(["task-open-spend"]);
	});

	it("returns an empty list when topK is 0 without embedding", async () => {
		writeTask(projectDir, {
			id: "task-spend",
			title: "Track spend",
			state: "ready",
			updatedAt: "2026-04-26T00:00:00.000Z",
		});
		await store.reindex();
		const before = provider.calls;
		const result = await store.searchTasks("cost", { topK: 0 });
		expect(result).toEqual([]);
		expect(provider.calls).toBe(before);
	});

	it("supportsSemanticSearch returns true", () => {
		expect(store.supportsSemanticSearch()).toBe(true);
	});
});
