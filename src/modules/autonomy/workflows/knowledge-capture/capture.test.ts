import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getKnowledgeStore, resetKnowledgeStore } from "#core/memory/knowledge-store.js";
import { captureRunInsight } from "./capture.js";

describe("captureRunInsight", () => {
	let projectDir: string;
	let runsDir: string;

	beforeEach(() => {
		projectDir = join(
			tmpdir(),
			`kota-capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		runsDir = join(projectDir, ".kota", "runs");
		mkdirSync(runsDir, { recursive: true });
		resetKnowledgeStore();
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
		resetKnowledgeStore();
	});

	function seedRun(
		runId: string,
		opts: {
			outcome?: string;
			taskId?: string;
			taskTitle?: string;
			commitMessage?: string;
			filesChanged?: string[];
			durationMs?: number;
		} = {},
	): string {
		const runDir = `.kota/runs/${runId}`;
		const runDirPath = join(projectDir, runDir);
		mkdirSync(runDirPath, { recursive: true });

		writeFileSync(
			join(runDirPath, "run-summary.json"),
			JSON.stringify({
				runId,
				workflow: "builder",
				outcome: opts.outcome ?? "success",
				taskId: opts.taskId ?? "task-test",
				taskTitle: opts.taskTitle ?? "Test task title",
				commitMessage: opts.commitMessage ?? "Fix the thing",
				filesChanged: opts.filesChanged ?? ["src/foo.ts", "src/bar.ts"],
				durationMs: opts.durationMs ?? 60000,
				completedAt: "2026-04-12T00:00:00Z",
			}),
		);

		writeFileSync(
			join(runDirPath, "commit-message.txt"),
			"Fix the thing\n\nDetailed commit body explaining what was done.",
		);

		return runDir;
	}

	it("creates a knowledge entry from a successful run", () => {
		const runId = "2026-04-12-test-run";
		const runDir = seedRun(runId);

		const result = captureRunInsight(projectDir, runDir, runId, "builder");

		expect(result.captured).toBe(true);
		expect(result.entryId).toBeDefined();

		const store = getKnowledgeStore(projectDir);
		const entry = store.read(result.entryId!);
		expect(entry).not.toBeNull();
		expect(entry!.title).toBe("Fix the thing");
		expect(entry!.type).toBe("run-insight");
		expect(entry!.tags).toContain(`run:${runId}`);
		expect(entry!.tags).toContain("workflow:builder");
		expect(entry!.tags).toContain("task:task-test");
		expect(entry!.content).toContain("Test task title");
		expect(entry!.content).toContain("src/foo.ts");
	});

	it("is idempotent — does not create duplicates", () => {
		const runId = "2026-04-12-dedup-run";
		const runDir = seedRun(runId);

		const first = captureRunInsight(projectDir, runDir, runId, "builder");
		const second = captureRunInsight(projectDir, runDir, runId, "builder");

		expect(first.captured).toBe(true);
		expect(second.captured).toBe(false);
		expect(second.reason).toBe("already captured");

		const store = getKnowledgeStore(projectDir);
		const entries = store.search(runId, { tag: `run:${runId}` });
		expect(entries).toHaveLength(1);
	});

	it("skips when run-summary.json is missing", () => {
		const runDir = ".kota/runs/missing-summary";
		mkdirSync(join(projectDir, runDir), { recursive: true });

		const result = captureRunInsight(projectDir, runDir, "missing-summary", "builder");
		expect(result.captured).toBe(false);
		expect(result.reason).toBe("no run-summary.json");
	});

	it("skips when outcome is not success", () => {
		const runId = "2026-04-12-failed-run";
		const runDir = seedRun(runId, { outcome: "failed" });

		const result = captureRunInsight(projectDir, runDir, runId, "builder");
		expect(result.captured).toBe(false);
		expect(result.reason).toBe("run outcome: failed");
	});

	it("includes file list in content", () => {
		const runId = "2026-04-12-files-run";
		const files = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`);
		const runDir = seedRun(runId, { filesChanged: files });

		const result = captureRunInsight(projectDir, runDir, runId, "builder");
		expect(result.captured).toBe(true);

		const store = getKnowledgeStore(projectDir);
		const entry = store.read(result.entryId!);
		expect(entry!.content).toContain("Files changed (25)");
		expect(entry!.content).toContain("src/file-0.ts");
		expect(entry!.content).toContain("... and 5 more");
	});

	it("includes duration in content", () => {
		const runId = "2026-04-12-stats-run";
		const runDir = seedRun(runId, { durationMs: 300000 });

		const result = captureRunInsight(projectDir, runDir, runId, "builder");
		const store = getKnowledgeStore(projectDir);
		const entry = store.read(result.entryId!);
		expect(entry!.content).toContain("duration: 5m");
	});

	it("stores meta fields on the entry", () => {
		const runId = "2026-04-12-meta-run";
		const runDir = seedRun(runId, { taskId: "task-custom" });

		const result = captureRunInsight(projectDir, runDir, runId, "builder");
		const store = getKnowledgeStore(projectDir);
		const entry = store.read(result.entryId!);
		expect(entry!.meta.runId).toBe(runId);
		expect(entry!.meta.workflow).toBe("builder");
		expect(entry!.meta.taskId).toBe("task-custom");
	});
});
