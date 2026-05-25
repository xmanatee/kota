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
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
		resetProviderRegistry();
	});

	it("uses the default disk store in commands-only mode before onLoad registers providers", async () => {
		const contributed = repoTasksModule.localClient!({
			cwd: projectDir,
		} as ModuleContext);

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
});
