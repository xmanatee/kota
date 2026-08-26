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

	it("fails closed for mutations before the workflow runtime is available", async () => {
		const contributed = repoTasksModule.localClient!({
			cwd: repoRoot,
			getProvider: () => null,
		} as unknown as ModuleContext);

		await expect(
			contributed.tasks!.create({
				title: "Command-created task",
				priority: "p2",
				area: "core",
				state: "backlog",
			}),
		).rejects.toThrow("Repo-task mutation requires the active workflow runtime");

		const listed = await contributed.tasks!.list(["backlog"]);
		expect(listed.tasks).toEqual([]);
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
