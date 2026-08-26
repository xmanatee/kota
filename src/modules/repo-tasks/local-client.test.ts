import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import repoTasksModule from "./index.js";

describe("repo-tasks localClient", () => {
	let projectDir: string;

	beforeEach(() => {
		resetProviderRegistry();
		projectDir = join(
			tmpdir(),
			`kota-repo-tasks-local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(projectDir, { recursive: true });
		execFileSync("git", ["init", "-q", "-b", "main"], {
			cwd: projectDir,
			stdio: "ignore",
		});
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
		resetProviderRegistry();
	});

	it("fails closed for mutations before the workflow runtime is available", async () => {
		const contributed = repoTasksModule.localClient!({
			cwd: projectDir,
		} as ModuleContext);

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
			cwd: projectDir,
		} as ModuleContext);

		await expect(contributed.tasks!.move("../AGENTS", "doing")).resolves.toEqual({
			ok: false,
			reason: "invalid_id",
		});
	});
});
