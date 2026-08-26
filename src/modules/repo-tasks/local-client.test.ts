import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import repoTasksModule from "./index.js";

describe("repo-tasks localClient", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = join(
			tmpdir(),
			`kota-repo-tasks-local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(repoRoot, { recursive: true });
		execFileSync("git", ["init", "-q", "-b", "main"], {
			cwd: repoRoot,
			stdio: "ignore",
		});
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("uses the default disk store in commands-only mode before onLoad registers providers", async () => {
		const contributed = repoTasksModule.localClient!({
			cwd: repoRoot,
			getProvider: () => null,
		} as unknown as ModuleContext);

		const created = await contributed.tasks!.create({
			title: "Commands-only fallback task",
			priority: "p2",
			area: "core",
			state: "backlog",
		});
		expect(created.ok).toBe(true);

		const listed = await contributed.tasks!.list(["backlog"]);
		expect(listed.tasks.map((task) => task.id)).toContain(
			"task-commands-only-fallback-task",
		);
	});

	it("returns a client error for traversal-shaped move ids", async () => {
		const contributed = repoTasksModule.localClient!({
			cwd: repoRoot,
			getProvider: () => null,
		} as unknown as ModuleContext);

		await expect(contributed.tasks!.move("../AGENTS", "doing")).resolves.toEqual({
			ok: false,
			reason: "invalid_id",
		});
	});
});
