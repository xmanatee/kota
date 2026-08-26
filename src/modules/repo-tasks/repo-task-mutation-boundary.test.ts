import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import {
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { LOGICAL_RESOURCE_AUTHORITY_PROVIDER_TYPE } from "#core/workflow/logical-resource-authority.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  decodeRepoTaskMutationRequest,
  mutateRepoTask,
} from "./repo-task-mutation-boundary.js";
import { createRepoTaskRuntimeSandbox } from "./repo-task-mutation-test-support.js";

const roots: string[] = [];
const runStates: RunStateDatabase[] = [];

afterEach(() => {
  for (const state of runStates.splice(0)) state.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	resetProviderRegistry();
});

function makeRuntimeSandboxTarget() {
	const scopeDir = join(
		tmpdir(),
		`kota-task-mutation-scope-${Date.now()}-${Math.random()}`,
	);
	roots.push(scopeDir);
	return createRepoTaskRuntimeSandbox(
		scopeDir,
		`repo-task-mutation-test-${Math.random().toString(36).slice(2)}`,
	);
}

function registerOwnedResource(input: {
	scopeRoot: string;
	scopeId: string;
	resourceKey: string;
	runId: string;
}): void {
	const runState = new RunStateDatabase(
		join(input.scopeRoot, ".kota", `state-${input.runId}`),
	);
	runStates.push(runState);
	runState.registerScope({
		id: input.scopeId,
		rootPath: input.scopeRoot,
		createdAt: "2026-08-26T00:00:00.000Z",
	});
	const { epoch } = runState.beginDaemonSession("2026-08-26T00:00:01.000Z");
	runState.admitRun({
		id: input.runId,
		scopeId: input.scopeId,
		workflow: "builder",
		repository: "write",
		trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
		resources: [input.resourceKey],
		admittedAt: "2026-08-26T00:00:02.000Z",
	});
	expect(runState.startRun(input.runId, epoch, "2026-08-26T00:00:03.000Z"))
		.toBe(1);
	initProviderRegistry().register(
		LOGICAL_RESOURCE_AUTHORITY_PROVIDER_TYPE,
		"test",
		runState,
	);
}

describe("repo-task mutation", () => {
  it("applies a canonical mutation for a standalone caller without daemon authority", async () => {
    const repoRoot = join(tmpdir(), `kota-task-mutation-${Date.now()}`);
    roots.push(repoRoot);
    mkdirSync(join(repoRoot, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(
      join(repoRoot, "data", "tasks", "ready", "task-example.md"),
      "---\nid: task-example\ntitle: Example\nstatus: ready\n---\n\n## Problem\n\nOld.\n",
    );
    const target = {
      authority: "canonical" as const,
      scopeId: buildDirectoryScope({ scopeRoot: repoRoot }).scopeId,
      scopeRoot: repoRoot,
    };

    await expect(
		mutateRepoTask(target, {
			kind: "update-body",
			id: "task-example",
			body: "## Problem\n\nUpdated.",
		}),
	).resolves.toMatchObject({ ok: true, id: "task-example", state: "ready" });
    expect(
      readFileSync(
        join(repoRoot, "data", "tasks", "ready", "task-example.md"),
        "utf8",
      ),
	).toContain("Updated.");
  });

  it("allows direct mutation only in a positively identified runtime sandbox", async () => {
	const target = makeRuntimeSandboxTarget();
	await expect(
		mutateRepoTask(target, {
        kind: "move",
        id: "task-missing",
        state: "doing",
      }),
	).resolves.toEqual({ ok: false, reason: "not_found" });

	const fakeScopeDir = join(
		tmpdir(),
		`kota-task-mutation-unproved-${Date.now()}`,
	);
	const fakeRunId = "forged-runtime-allocation";
	const fakeAllocation = "forged-allocation";
	const fakeRuntimeDir = join(fakeScopeDir, ".kota", "runtime");
	const fakeScopeRoot = join(
		fakeRuntimeDir,
		"worktrees",
		fakeAllocation,
	);
	const fakeRunDir = join(fakeRuntimeDir, fakeAllocation);
	const fakeAgentDir = join(fakeRunDir, "agent");
	const fakeTempDir = join(fakeRunDir, "tmp");
	const fakeArtifactDir = join(fakeRunDir, "artifacts");
	for (const path of [
		fakeScopeRoot,
		fakeAgentDir,
		fakeTempDir,
		fakeArtifactDir,
	]) {
		mkdirSync(path, { recursive: true });
	}
	roots.push(fakeScopeDir);
	await expect(
		mutateRepoTask(
			{
				authority: "runtime-owned-sandbox",
				runId: fakeRunId,
				workspaceRoot: fakeScopeRoot,
				scopeRoot: fakeScopeDir,
				runtimeResources: {
					profileId: `${fakeRunId}:1`,
					agentRunDir: fakeAgentDir,
					tempRoot: fakeTempDir,
					artifactRoot: fakeArtifactDir,
					env: {
						KOTA_WORKSPACE_DIR: fakeScopeRoot,
						KOTA_RUN_DIR: fakeAgentDir,
						KOTA_RUN_TEMP_DIR: fakeTempDir,
						KOTA_RUN_ARTIFACT_DIR: fakeArtifactDir,
					},
				},
			},
			{
				kind: "move",
				id: "task-missing",
				state: "doing",
			},
		),
	).rejects.toThrow(/runtime-owned sandbox proof/i);
  });

	it("refuses a canonical mutation while a daemon run owns the task resource", async () => {
		const repoRoot = join(tmpdir(), `kota-task-mutation-canonical-${Date.now()}`);
		roots.push(repoRoot);
		mkdirSync(join(repoRoot, "data", "tasks", "ready"), { recursive: true });
		writeFileSync(
			join(repoRoot, "data", "tasks", "ready", "task-owned.md"),
			"---\nid: task-owned\ntitle: Owned\nstatus: ready\n---\n\n## Problem\n\nOld.\n",
		);
		const scopeId = buildDirectoryScope({ scopeRoot: repoRoot }).scopeId;
		registerOwnedResource({
			scopeRoot: repoRoot,
			scopeId,
			resourceKey: "task:task-owned",
			runId: "active-builder",
		});

		await expect(
			mutateRepoTask({ authority: "canonical", scopeId, scopeRoot: repoRoot }, {
				kind: "move",
				id: "task-owned",
				state: "doing",
			}),
		).rejects.toMatchObject({
			name: "ResourceAlreadyOwnedError",
			resourceKey: "task:task-owned",
			ownerRunId: "active-builder",
		});
		expect(
			readFileSync(
				join(repoRoot, "data", "tasks", "ready", "task-owned.md"),
				"utf8",
			),
		).toContain("status: ready");
	});

	it("uses one inbox resource identity for capture and retraction", async () => {
		const repoRoot = join(tmpdir(), `kota-inbox-mutation-${Date.now()}`);
		roots.push(repoRoot);
		mkdirSync(join(repoRoot, "data", "inbox"), { recursive: true });
		const path = join(repoRoot, "data", "inbox", "note-owned.md");
		writeFileSync(path, "owned\n");
		const scopeId = buildDirectoryScope({ scopeRoot: repoRoot }).scopeId;
		registerOwnedResource({
			scopeRoot: repoRoot,
			scopeId,
			resourceKey: "inbox:note-owned",
			runId: "active-inbox-writer",
		});

		await expect(
			mutateRepoTask({ authority: "canonical", scopeId, scopeRoot: repoRoot }, {
				kind: "retract-inbox",
				path: "data/inbox/note-owned.md",
			}),
		).rejects.toMatchObject({
			name: "ResourceAlreadyOwnedError",
			resourceKey: "inbox:note-owned",
			ownerRunId: "active-inbox-writer",
		});
		expect(readFileSync(path, "utf8")).toBe("owned\n");
	});

	it("does not partially collect terminal tasks when one task resource is owned", async () => {
		const repoRoot = join(tmpdir(), `kota-gc-mutation-${Date.now()}`);
		roots.push(repoRoot);
		const doneDir = join(repoRoot, "data", "tasks", "done");
		mkdirSync(doneDir, { recursive: true });
		for (const id of ["task-a", "task-b"]) {
			writeFileSync(
				join(doneDir, `${id}.md`),
				`---\nid: ${id}\ntitle: ${id}\nstatus: done\nupdated_at: 2020-01-01T00:00:00.000Z\n---\n`,
			);
		}
		const scopeId = buildDirectoryScope({ scopeRoot: repoRoot }).scopeId;
		registerOwnedResource({
			scopeRoot: repoRoot,
			scopeId,
			resourceKey: "task:task-b",
			runId: "active-terminal-writer",
		});

		await expect(
			mutateRepoTask({ authority: "canonical", scopeId, scopeRoot: repoRoot }, {
				kind: "gc",
				options: { days: 30 },
			}),
		).rejects.toMatchObject({
			name: "ResourceAlreadyOwnedError",
			resourceKey: "task:task-b",
			ownerRunId: "active-terminal-writer",
		});
		expect(existsSync(join(doneDir, "task-a.md"))).toBe(true);
		expect(existsSync(join(doneDir, "task-b.md"))).toBe(true);
	});

  it("rejects invalid untyped workflow payloads before resource admission", () => {
    expect(() =>
      decodeRepoTaskMutationRequest({
        kind: "create",
        options: { title: "Bad", priority: "p9", area: "core", state: "ready" },
      }),
    ).toThrow(/valid priority/);
    expect(() =>
      decodeRepoTaskMutationRequest({ kind: "gc", options: { days: 0 } }),
    ).toThrow(/positive number/);
  });

	it("does not overwrite a colliding quick-create inbox id", async () => {
	const target = makeRuntimeSandboxTarget();
	const repoRoot = target.workspaceRoot;
    mkdirSync(join(repoRoot, "data", "inbox"), { recursive: true });
    const path = join(repoRoot, "data", "inbox", "task-example.md");
    writeFileSync(path, "original\n");

	await expect(
		mutateRepoTask(target, {
        kind: "quick-create",
        id: "task-example",
        title: "Replacement",
        summary: "must not win",
      }),
	).resolves.toEqual({ ok: false, reason: "already_exists" });
    expect(readFileSync(path, "utf8")).toBe("original\n");
  });
});
