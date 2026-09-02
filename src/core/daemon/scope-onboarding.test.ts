import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  createScopeAuthorityOperatorTokenVerifier,
  SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER,
  type ScopeAuthorityOperatorAction,
  scopeAuthorityOperatorHeadersForInteractiveClient,
  scopeAuthorityOperatorTokenPath,
} from "./scope-authority-operator-token.js";
import { ScopeAuthorityService } from "./scope-authority-service.js";
import { ScopeAuthorityStore } from "./scope-authority-store.js";
import { ScopeLifecycleService } from "./scope-lifecycle.js";
import {
  type ScopeOnboardingOperation,
  ScopeOnboardingService,
} from "./scope-onboarding.js";
import { ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeRegistry } from "./scope-runtime.js";
import { ScopeRuntimeHost } from "./scope-runtime-host.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ScopeOnboardingService", () => {
  it("onboards repositories and empty directories through one resumable transaction", async () => {
    const fixture = await createFixture();
    const repository = join(fixture.root, "repository");
    const emptyDirectory = join(fixture.root, "notes");
    mkdirSync(repository, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    mkdirSync(join(emptyDirectory, ".kota"), { recursive: true });
    writeFileSync(join(repository, "AGENTS.md"), "# Repository guidance\n");
    writeFileSync(
      join(emptyDirectory, ".kota", "config.json"),
      JSON.stringify({ guardrails: { policies: { dangerous: "allow" } } }),
    );
    fixture.missingSetupRoots.add(emptyDirectory);

    try {
      const repositoryInspection = await fixture.service.inspect(repository);
      expect(repositoryInspection).toMatchObject({
        kind: "git-repository",
        registered: false,
        trust: null,
        existing: { guidance: ["AGENTS.md"], taskQueue: false },
      });
      expect(existsSync(join(repository, "data"))).toBe(false);

      const repositoryPlan = await fixture.service.plan(repository, {
        trust: true,
        initialAutomationMode: "supervised",
        writes: { mode: "scope-directory" },
      });
      expect(repositoryPlan.ok).toBe(true);
      if (!repositoryPlan.ok) return;
      expect(repositoryPlan.plan.permissions).toEqual({
        trusted: true,
        autonomy: "supervised",
        writes: { mode: "scope-directory" },
      });
      expect(repositoryPlan.plan.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ owner: "machine", kind: "register-scope" }),
        expect.objectContaining({ owner: "machine", kind: "set-authority", trust: true }),
        expect.objectContaining({ owner: "scope", kind: "create-runtime-directory" }),
      ]));
      const repositoryRuntimeDirectories = repositoryPlan.plan.changes.flatMap((change) =>
        change.owner === "scope" ? [change.path] : []
      );

      const repositoryApplied = await fixture.service.apply(
        repositoryPlan.plan,
        operatorAction(fixture.authorityConfigPath, true),
      );
      expect(repositoryApplied.ok).toBe(true);
      if (!repositoryApplied.ok) return;
      expect(repositoryApplied.operation.readiness).toMatchObject({
        registered: true,
        configured: true,
        trusted: true,
        workflowReady: true,
        blocked: false,
        partiallyApplied: false,
      });
      expect(repositoryApplied.operation.mutations).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "activate-scope", status: "applied" }),
      ]));
      expect(repositoryRuntimeDirectories.every((path) =>
        existsSync(join(repository, path))
      )).toBe(true);
      expect(listRuntimeDirectories(repository)).toEqual(
        [...repositoryRuntimeDirectories].sort(),
      );

      const duplicateApply = await fixture.service.apply(
        repositoryPlan.plan,
        operatorAction(fixture.authorityConfigPath, true),
      );
      expect(duplicateApply).toEqual(repositoryApplied);
      expect(fixture.authority.inspect(repositoryPlan.plan.scopeId)).toMatchObject({
        audit: [expect.objectContaining({ revision: 1 })],
      });
      expect((await fixture.service.inspect(repository)).registered).toBe(true);

      const emptyInspection = await fixture.service.inspect(emptyDirectory);
      expect(emptyInspection).toMatchObject({
        kind: "directory",
        registered: false,
        existing: { kotaState: true, scopeConfig: true, taskQueue: false },
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "setup_missing" }),
        ]),
      });
      const emptyPlan = await fixture.service.plan(emptyDirectory);
      expect(emptyPlan.ok).toBe(true);
      if (!emptyPlan.ok) return;
      expect(emptyPlan.plan.permissions).toEqual({
        trusted: false,
        autonomy: "passive",
        writes: { mode: "none" },
      });

      const failed = await fixture.service.apply(emptyPlan.plan);
      expect(failed).toMatchObject({
        ok: false,
        reason: "operator_action_required",
        operation: {
          state: "incomplete",
          readiness: { registered: false, workflowReady: false },
        },
      });
      const emptyRuntimeDirectories = emptyPlan.plan.changes.flatMap((change) =>
        change.owner === "scope" ? [change.path] : []
      );
      expect(emptyRuntimeDirectories.every((path) =>
        !existsSync(join(emptyDirectory, path))
      )).toBe(true);
      expect(existsSync(join(emptyDirectory, ".kota", "config.json"))).toBe(true);
      expect(fixture.host.hostedCount()).toBe(2);

      const retried = await fixture.service.retry(
        emptyPlan.plan.operationId,
        operatorAction(fixture.authorityConfigPath, false),
      );
      expect(retried.ok).toBe(true);
      if (!retried.ok) return;
      expect(retried.operation).toMatchObject({
        state: "succeeded",
        attempts: 2,
        readiness: {
          registered: true,
          configured: true,
          trusted: false,
          workflowReady: false,
          blocked: true,
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "scope_untrusted" }),
            expect.objectContaining({ code: "setup_missing" }),
            expect.objectContaining({ code: "repository_write_unavailable" }),
          ]),
        },
      });
      expect(fixture.host.hostedCount()).toBe(3);

      expect(await fixture.service.status(emptyPlan.plan.operationId)).toEqual(retried.operation);
      const artifactPath = join(
        fixture.stateDir,
        "scope-onboarding",
        `${emptyPlan.plan.operationId}.json`,
      );
      const artifact = readFileSync(artifactPath, "utf8");
      expect(JSON.parse(artifact)).toMatchObject({
        acceptedPlan: { planId: emptyPlan.plan.planId },
        readiness: { scopeId: emptyPlan.plan.scopeId },
        provenance: { actor: "operator" },
      });
      expect(artifact).not.toContain("secretValues");
    } finally {
      await fixture.close();
    }
  });

  it("rejects a nested Git directory whose writer sandbox would escape the scope", async () => {
    const fixture = await createFixture();
    const repositoryRoot = join(fixture.root, "repository-with-nested-scope");
    const nestedDirectory = join(repositoryRoot, "selected-directory");
    mkdirSync(nestedDirectory, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repositoryRoot });

    try {
      expect(await fixture.service.inspect(nestedDirectory)).toMatchObject({
        directoryRoot: nestedDirectory,
        kind: "git-repository",
        registered: false,
        blockers: [expect.objectContaining({
          code: "repository_root_required",
          capability: "scope-improver",
          message: expect.stringContaining(repositoryRoot),
        })],
      });
      expect(await fixture.service.plan(nestedDirectory, {
        trust: true,
        initialAutomationMode: "supervised",
        writes: { mode: "scope-directory" },
      })).toMatchObject({
        ok: false,
        reason: "invalid_directory",
        message: expect.stringContaining(repositoryRoot),
      });
      expect(fixture.registry.getByRoot(nestedDirectory)).toBeUndefined();
      expect(existsSync(join(nestedDirectory, ".kota"))).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("leaves task-queue directory creation to the repo-task domain", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "target");
    mkdirSync(join(target, "data"), { recursive: true });
    writeFileSync(join(target, "data", "tasks"), "not a directory");
    try {
      const planned = await fixture.service.plan(target);
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.plan.changes
        .filter((change) => change.owner === "scope")
        .every((change) => change.path.startsWith(".kota/"))).toBe(true);
      expect(await fixture.service.apply(
        planned.plan,
        operatorAction(fixture.authorityConfigPath, false),
      )).toMatchObject({ ok: true });
      expect(readFileSync(join(target, "data", "tasks"), "utf8")).toBe("not a directory");
    } finally {
      await fixture.close();
    }
  });

  it("write-ahead checkpoints directory ownership before the filesystem effect", async () => {
    let fixture!: Awaited<ReturnType<typeof createFixture>>;
    let crashCheckpoint: ScopeOnboardingOperation | null = null;
    let checkpointObservedBeforeCreation = false;
    fixture = await createFixture({
      createRuntimeDirectory: (target) => {
        const operationFile = readdirSync(join(fixture.stateDir, "scope-onboarding")).at(0);
        if (operationFile === undefined) throw new Error("onboarding checkpoint is missing");
        crashCheckpoint = JSON.parse(readFileSync(
          join(fixture.stateDir, "scope-onboarding", operationFile),
          "utf8",
        )) as ScopeOnboardingOperation;
        checkpointObservedBeforeCreation = crashCheckpoint.mutations.some((mutation) =>
          mutation.kind === "create-runtime-directory" &&
          mutation.target === ".kota" &&
          mutation.status === "prepared"
        );
        mkdirSync(target);
        throw new Error("fixture process stopped after directory creation");
      },
    });
    const target = join(fixture.root, "directory-checkpoint-crash");
    mkdirSync(target);
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false,
      reason: "apply_failed",
    });
    expect(checkpointObservedBeforeCreation).toBe(true);
    expect(existsSync(join(target, ".kota"))).toBe(false);
    if (crashCheckpoint === null) throw new Error("fixture did not capture the crash checkpoint");

    const operationPath = join(
      fixture.stateDir,
      "scope-onboarding",
      `${planned.plan.operationId}.json`,
    );
    writeFileSync(operationPath, JSON.stringify(crashCheckpoint, null, 2));
    mkdirSync(join(target, ".kota"));

    expect(await fixture.restartService().cancel(planned.plan.operationId)).toMatchObject({
      ok: true,
      operation: { state: "cancelled" },
    });
    expect(existsSync(join(target, ".kota"))).toBe(false);
    await fixture.close();
  });

  it("accepts a freshly validated plan after cancellation", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "cancelled-replacement");
    mkdirSync(target);
    const firstPlan = await fixture.service.plan(target);
    expect(firstPlan.ok).toBe(true);
    if (!firstPlan.ok) return;
    expect(await fixture.service.apply(firstPlan.plan)).toMatchObject({ ok: false });
    expect(await fixture.service.cancel(firstPlan.plan.operationId)).toMatchObject({
      ok: true,
      operation: { state: "cancelled" },
    });

    const replacementPlan = await fixture.service.plan(target);
    expect(replacementPlan.ok).toBe(true);
    if (!replacementPlan.ok) return;
    expect(replacementPlan.plan.operationId).toBe(firstPlan.plan.operationId);
    expect(await fixture.service.apply(
      replacementPlan.plan,
      operatorAction(fixture.authorityConfigPath, false),
    )).toMatchObject({ ok: true, operation: { state: "succeeded" } });
    await fixture.close();
  });

  it.each(["file", "symlink"] as const)(
    "rejects and cleanly cancels a runtime-path %s conflict",
    async (kind) => {
      const fixture = await createFixture();
      const target = join(fixture.root, `runtime-path-${kind}`);
      const conflict = join(target, ".kota");
      mkdirSync(target);
      if (kind === "file") {
        writeFileSync(conflict, "operator-owned state");
      } else {
        const linkedDirectory = join(fixture.root, "linked-kota-state");
        mkdirSync(linkedDirectory);
        symlinkSync(linkedDirectory, conflict, "dir");
      }

      const planned = await fixture.service.plan(target);
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.plan.blockers).toContainEqual(expect.objectContaining({
        code: "runtime_path_conflict",
        capability: "scope-runtime",
      }));
      expect(planned.plan.changes).not.toContainEqual(expect.objectContaining({
        owner: "scope",
        path: ".kota",
      }));

      expect(await fixture.service.apply(planned.plan)).toMatchObject({
        ok: false,
        reason: "apply_failed",
        operation: { state: "incomplete", registeredByOperation: false },
      });
      expect(await fixture.service.cancel(planned.plan.operationId)).toMatchObject({
        ok: true,
        operation: { state: "cancelled" },
      });
      expect(fixture.registry.getByRoot(target)).toBeUndefined();
      if (kind === "file") {
        expect(readFileSync(conflict, "utf8")).toBe("operator-owned state");
      } else {
        expect(lstatSync(conflict).isSymbolicLink()).toBe(true);
      }
      await fixture.close();
    },
  );

  it("does not treat an empty .git directory as repository capability", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "fake-repository");
    mkdirSync(join(target, ".git"), { recursive: true });
    try {
      expect(await fixture.service.inspect(target)).toMatchObject({ kind: "directory" });
      const planned = await fixture.service.plan(target, {
        trust: true,
        writes: { mode: "none" },
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.plan.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "repository_write_unavailable" }),
      ]));
      const applied = await fixture.service.apply(
        planned.plan,
        operatorAction(fixture.authorityConfigPath, true),
      );
      expect(applied).toMatchObject({
        ok: true,
        operation: {
          readiness: {
            blocked: true,
            workflowReady: false,
            reasons: expect.arrayContaining([
              expect.objectContaining({ code: "repository_write_unavailable" }),
            ]),
          },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("keeps prepared registration closed until authority commits", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "held-apply");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    let releaseAuthority!: () => void;
    let authorityReached!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      authorityReached = resolve;
    });
    const applyAuthority = fixture.authority.applyTransactional.bind(fixture.authority);
    const authoritySpy = vi.spyOn(fixture.authority, "applyTransactional").mockImplementation(
      async (scopeId, mutation, operator) => {
        authorityReached();
        await held;
        return applyAuthority(scopeId, mutation, operator);
      },
    );
    const applying = fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );
    try {
      await reached;
      expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
        state: "applying",
        registeredByOperation: true,
        mutations: expect.arrayContaining([
          expect.objectContaining({ kind: "register-scope", status: "applied" }),
        ]),
        readiness: {
          registered: true,
          configured: true,
          workflowReady: false,
          blocked: true,
          partiallyApplied: true,
        },
      });
      expect(fixture.service.isActivationAllowed(planned.plan.scopeId)).toBe(false);
      expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("inactive");
    } finally {
      releaseAuthority();
    }
    expect(await applying).toMatchObject({
      ok: true,
      operation: { state: "succeeded", readiness: { workflowReady: true } },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("hosted");
    authoritySpy.mockRestore();
    await fixture.close();
  });

  it("compensates authority before rolling back a failed activation", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "activation-failure");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const activationSpy = vi.spyOn(fixture.lifecycle, "activatePreparedScope")
      .mockImplementationOnce(async () => {
        fixture.bus.emit("test.onboarding.ready", { scopeId: planned.plan.scopeId });
        expect(fixture.runState.listRuns(planned.plan.scopeId)).toEqual([]);
        return {
          ok: false,
          reason: "scope_not_hosted",
          message: "fixture activation failed",
          scopeId: planned.plan.scopeId,
        };
      });

    const applied = await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );

    expect(applied).toMatchObject({
      ok: false,
      reason: "apply_failed",
      operation: {
        state: "incomplete",
        registeredByOperation: false,
        authorityApplied: null,
        readiness: { registered: false, partiallyApplied: false },
      },
    });
    const authorityFile = JSON.parse(readFileSync(fixture.authorityConfigPath, "utf8")) as {
      trustedScopes?: string[];
      scopePolicies?: Array<{ scopeId: string }>;
      scopeAuthority: { audit: Array<{ scopeId: string; trust: { after: boolean } }> };
    };
    expect(authorityFile.trustedScopes ?? []).not.toContain(target);
    expect(authorityFile.scopePolicies ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeId: planned.plan.scopeId }),
    ]));
    expect(authorityFile.scopeAuthority.audit).toEqual([
      expect.objectContaining({ scopeId: planned.plan.scopeId, trust: { after: true } }),
      expect.objectContaining({ scopeId: planned.plan.scopeId, trust: { after: false } }),
    ]);
    expect(fixture.runState.getScopeIdByRootPath(target)).toBeNull();
    activationSpy.mockRestore();
    await fixture.close();
  });

  it("rolls back onboarding authority after an unrelated scope authority commit", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "activation-failure-after-unrelated-authority");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const unrelatedScopeId = fixture.registry.getDefaultScopeId();
    const activationSpy = vi.spyOn(fixture.lifecycle, "activatePreparedScope")
      .mockImplementationOnce(async () => {
        const unrelated = await fixture.authority.apply(unrelatedScopeId, {
          expectedRevision: fixture.authority.currentRevision(),
          reason: "Apply an unrelated scope restriction during onboarding.",
          policy: {
            scopeId: unrelatedScopeId,
            reason: "Keep the fixture default scope read-only.",
            writes: { mode: "none" },
          },
        }, operatorAction(fixture.authorityConfigPath, false));
        expect(unrelated.ok).toBe(true);
        return {
          ok: false as const,
          reason: "scope_not_hosted" as const,
          message: "fixture activation failed after unrelated authority update",
          scopeId: planned.plan.scopeId,
        };
      });

    const applied = await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );

    expect(applied).toMatchObject({
      ok: false,
      reason: "apply_failed",
      operation: {
        registeredByOperation: false,
        authorityApplied: null,
        readiness: { partiallyApplied: false },
      },
    });
    expect(fixture.authority.inspect(unrelatedScopeId)).toMatchObject({
      policyFragment: { writes: { mode: "none" } },
    });
    expect(fixture.registry.get(planned.plan.scopeId)).toBeUndefined();
    activationSpy.mockRestore();
    await fixture.close();
  });

  it("reports a workflow readiness probe failure without claiming readiness", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "readiness-failure");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    fixture.workflowProbeFailureScopes.add(planned.plan.scopeId);

    const applied = await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );

    expect(applied).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        readiness: {
          registered: true,
          workflowReady: false,
          blocked: true,
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "workflow_inspection_failed" }),
          ]),
        },
      },
    });
    expect(fixture.registry.get(planned.plan.scopeId)).toBeDefined();
    expect(fixture.host.isHosted(planned.plan.scopeId)).toBe(true);
    await fixture.close();
  });

  it("publishes newly unblocked successful onboarding through status or retry exactly once", async () => {
    const fixture = await createFixture();
    const statusTarget = join(fixture.root, "readiness-status-recovery");
    mkdirSync(statusTarget);
    execFileSync("git", ["init", "--quiet"], { cwd: statusTarget });
    const statusPlan = await fixture.service.plan(statusTarget, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(statusPlan.ok).toBe(true);
    if (!statusPlan.ok) return;
    fixture.workflowProbeFailureScopes.add(statusPlan.plan.scopeId);
    expect(await fixture.service.apply(
      statusPlan.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: { state: "succeeded", readiness: { workflowReady: false } },
    });

    fixture.workflowProbeFailureScopes.delete(statusPlan.plan.scopeId);
    expect(await fixture.service.status(statusPlan.plan.operationId)).toMatchObject({
      state: "succeeded",
      readiness: { workflowReady: true, blocked: false },
      mutations: expect.arrayContaining([
        expect.objectContaining({ kind: "complete-onboarding", status: "applied" }),
      ]),
    });
    expect(await fixture.service.status(statusPlan.plan.operationId)).toMatchObject({
      readiness: { workflowReady: true },
    });
    expect(fixture.onboardingTransitions).toHaveLength(1);

    const retryTarget = join(fixture.root, "readiness-retry-recovery");
    mkdirSync(retryTarget);
    execFileSync("git", ["init", "--quiet"], { cwd: retryTarget });
    const retryPlan = await fixture.service.plan(retryTarget, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(retryPlan.ok).toBe(true);
    if (!retryPlan.ok) return;
    fixture.workflowProbeFailureScopes.add(retryPlan.plan.scopeId);
    expect(await fixture.service.apply(
      retryPlan.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: { readiness: { workflowReady: false } },
    });

    fixture.workflowProbeFailureScopes.delete(retryPlan.plan.scopeId);
    expect(await fixture.service.retry(retryPlan.plan.operationId)).toMatchObject({
      ok: true,
      operation: { readiness: { workflowReady: true, blocked: false } },
    });
    expect(await fixture.service.retry(retryPlan.plan.operationId)).toMatchObject({
      ok: true,
      operation: { readiness: { workflowReady: true } },
    });
    expect(fixture.onboardingTransitions).toHaveLength(2);
    await fixture.close();
  });

  it("closes and removes an activated runtime when its lifecycle notification fails", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "post-activation-failure");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const stopThrowing = fixture.bus.on("scope.lifecycle.changed", (payload) => {
      if (payload.transition === "registered") {
        throw new Error("fixture onboarding subscriber failed");
      }
    });

    const applied = await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );

    expect(applied).toMatchObject({
      ok: false,
      reason: "apply_failed",
      operation: {
        state: "incomplete",
        registeredByOperation: false,
        authorityApplied: null,
        readiness: { registered: false, workflowReady: false, partiallyApplied: false },
      },
    });
    expect(fixture.registry.get(planned.plan.scopeId)).toBeUndefined();
    expect(fixture.host.isHosted(planned.plan.scopeId)).toBe(false);
    expect(fixture.runState.getScopeIdByRootPath(target)).toBeNull();
    stopThrowing();
    await fixture.close();
  });

  it("refreshes every actionable readiness reason for an incomplete operation", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "incomplete-readiness");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    fixture.workflowProbeFailureScopes.add(planned.plan.scopeId);
    const activationSpy = vi.spyOn(fixture.lifecycle, "activatePreparedScope")
      .mockResolvedValueOnce({
        ok: false,
        reason: "scope_not_hosted",
        message: "fixture activation failed",
        scopeId: planned.plan.scopeId,
      });
    const compensationSpy = vi.spyOn(fixture.authority, "compensate")
      .mockResolvedValueOnce({
        ok: false,
        reason: "revision_conflict",
        message: "fixture holds the applied authority for status inspection",
        scopeId: planned.plan.scopeId,
        currentRevision: 1,
      });

    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, false),
    )).toMatchObject({ ok: false, reason: "rollback_failed" });
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      state: "incomplete",
      readiness: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "scope_untrusted" }),
          expect.objectContaining({ code: "scope_improver_write_denied" }),
          expect.objectContaining({ code: "scope_improver_passive" }),
          expect.objectContaining({ code: "workflow_inspection_failed" }),
          expect.objectContaining({ code: "workflow_unavailable" }),
          expect.objectContaining({ code: "onboarding_incomplete" }),
        ]),
      },
    });

    activationSpy.mockRestore();
    compensationSpy.mockRestore();
    expect(await fixture.service.cancel(planned.plan.operationId)).toMatchObject({ ok: true });
    await fixture.close();
  });

  it("applies a planned display name to an existing registration", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "existing-scope");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const registered = await fixture.lifecycle.registerDirectoryScope({ directoryRoot: target });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const planned = await fixture.service.plan(target, {
      displayName: "Research notes",
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.changes).toContainEqual({
      owner: "machine",
      kind: "update-display-name",
      scopeId: registered.scope.scopeId,
      displayName: "Research notes",
    });

    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({ ok: true });
    expect(fixture.registry.get(registered.scope.scopeId)?.displayName).toBe("Research notes");
    expect(fixture.onboardingTransitions).toContain("onboarding-completed");
    await fixture.close();
  });

  it("preserves unrelated authority restrictions on an existing scope", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "existing-restricted-scope");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const registered = await fixture.lifecycle.registerDirectoryScope({ directoryRoot: target });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const baseline = {
      scopeId: registered.scope.scopeId,
      reason: "Keep the existing scope restrictions.",
      allowChildWidening: ["retention"] as const,
      autonomy: { defaultMode: "supervised" as const, maxMode: "supervised" as const },
      writes: { mode: "scope-directory" as const },
      channels: {
        mode: "allow-list" as const,
        allowedChannels: ["operator"],
        blockedSources: ["external"],
        ignoredSources: ["automation"],
      },
      setup: { visibility: "metadata" as const },
      ownerConfirmation: {
        localWrite: "confirm" as const,
        externalWrite: "deny" as const,
        destructive: "deny" as const,
      },
      retention: {
        mode: "expire-after-days" as const,
        maxAgeDays: 7,
        redaction: "full" as const,
      },
      modules: {
        defaultAvailability: "disabled" as const,
        overrides: [{ moduleName: "repo-task", availability: "enabled" as const }],
      },
      externalEffects: {
        networkRead: "confirm" as const,
        networkWrite: "deny" as const,
        networkDestructive: "deny" as const,
      },
    };
    expect(await fixture.authority.apply(
      registered.scope.scopeId,
      {
        expectedRevision: fixture.authority.currentRevision(),
        reason: "Establish fixture restrictions before onboarding.",
        trust: true,
        policy: baseline,
      },
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({ ok: true });

    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "passive",
      writes: { mode: "none" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({ ok: true });

    const inspected = fixture.authority.inspect(registered.scope.scopeId);
    expect(inspected).toMatchObject({
      policyFragment: {
        allowChildWidening: baseline.allowChildWidening,
        autonomy: { defaultMode: "passive", maxMode: "passive" },
        writes: { mode: "none" },
        channels: baseline.channels,
        setup: baseline.setup,
        ownerConfirmation: baseline.ownerConfirmation,
        retention: baseline.retention,
        modules: baseline.modules,
        externalEffects: baseline.externalEffects,
      },
    });
    await fixture.close();
  });

  it("retries a write-ahead completion publication without duplicate admission", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "completion-publication-retry");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    let preparedBeforeDelivery = false;
    const stopThrowing = fixture.bus.on("scope.lifecycle.changed", (payload) => {
      if (payload.transition !== "onboarding-completed") return;
      const artifact = JSON.parse(readFileSync(
        join(
          fixture.stateDir,
          "scope-onboarding",
          `${planned.plan.operationId}.json`,
        ),
        "utf8",
      )) as ScopeOnboardingOperation;
      preparedBeforeDelivery = artifact.mutations.some((mutation) =>
        mutation.kind === "complete-onboarding" &&
        mutation.status === "prepared" &&
        mutation.target === payload.idempotencyKey
      );
      throw new Error("fixture completion observer failed after workflow admission");
    });

    const applied = await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );
    expect(applied).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        readiness: {
          registered: true,
          workflowReady: false,
          partiallyApplied: false,
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "onboarding_completion_failed" }),
          ]),
        },
      },
    });
    expect(preparedBeforeDelivery).toBe(true);
    expect(fixture.registry.get(planned.plan.scopeId)).toBeDefined();
    expect(fixture.host.isHosted(planned.plan.scopeId)).toBe(true);
    const firstRuns = fixture.runState.listRuns(planned.plan.scopeId)
      .filter((run) => run.workflow === "scope-improvement-onboarding");
    expect(firstRuns).toHaveLength(1);
    const publicationId = `scope-onboarding:${planned.plan.operationId}:completed`;
    expect(firstRuns[0]?.trigger).toMatchObject({
      eventId: publicationId,
      payload: { idempotencyKey: publicationId },
    });

    stopThrowing();
    expect(await fixture.service.retry(planned.plan.operationId)).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        readiness: { workflowReady: true, blocked: false },
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "complete-onboarding",
            target: publicationId,
            status: "applied",
          }),
        ]),
      },
    });
    expect(fixture.runState.listRuns(planned.plan.scopeId)
      .filter((run) => run.workflow === "scope-improvement-onboarding")).toHaveLength(1);
    await fixture.close();
  });

  it("recovers a succeeded completion publication at startup without operator action", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "completion-publication-startup-recovery");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    fixture.workflowProbeFailureScopes.add(planned.plan.scopeId);
    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: { state: "succeeded", readiness: { workflowReady: false } },
    });
    expect(fixture.onboardingTransitions).toHaveLength(0);

    fixture.workflowProbeFailureScopes.delete(planned.plan.scopeId);
    const restarted = fixture.restartService();
    expect(await restarted.recoverForStartup(planned.plan.scopeId)).toBe(true);
    expect(fixture.onboardingTransitions).toHaveLength(1);
    expect(fixture.runState.listRuns(planned.plan.scopeId)
      .filter((run) => run.workflow === "scope-improvement-onboarding")).toHaveLength(1);
    expect(await restarted.status(planned.plan.operationId)).toMatchObject({
      state: "succeeded",
      readiness: { workflowReady: true, blocked: false },
      mutations: expect.arrayContaining([
        expect.objectContaining({
          kind: "complete-onboarding",
          status: "applied",
        }),
      ]),
    });
    expect(fixture.onboardingTransitions).toHaveLength(1);
    await fixture.close();
  });

  it("keeps pre-existing scopes active and recoverable after restart", async () => {
    const fixture = await createFixture();
    const retryTarget = join(fixture.root, "existing-retry");
    const cancelTarget = join(fixture.root, "existing-cancel");
    mkdirSync(retryTarget);
    mkdirSync(cancelTarget);
    const retryRegistration = await fixture.lifecycle.registerDirectoryScope({
      directoryRoot: retryTarget,
    });
    const cancelRegistration = await fixture.lifecycle.registerDirectoryScope({
      directoryRoot: cancelTarget,
    });
    expect(retryRegistration.ok).toBe(true);
    expect(cancelRegistration.ok).toBe(true);
    if (!retryRegistration.ok || !cancelRegistration.ok) return;

    const retryPlan = await fixture.service.plan(retryTarget);
    expect(retryPlan.ok).toBe(true);
    if (!retryPlan.ok) return;
    const failedRetry = await fixture.service.apply(retryPlan.plan);
    expect(failedRetry).toMatchObject({ ok: false, operation: { state: "incomplete" } });
    expect(fixture.service.isActivationAllowed(retryRegistration.scope.scopeId)).toBe(false);
    expect(await fixture.restartService().recoverForStartup(
      retryRegistration.scope.scopeId,
    )).toBe(true);
    expect(fixture.lifecycle.getHostingState(retryRegistration.scope.scopeId)).toBe("hosted");
    expect(await fixture.restartService().retry(
      retryPlan.plan.operationId,
      operatorAction(fixture.authorityConfigPath, false),
    )).toMatchObject({ ok: true, operation: { state: "succeeded" } });

    const cancelPlan = await fixture.service.plan(cancelTarget);
    expect(cancelPlan.ok).toBe(true);
    if (!cancelPlan.ok) return;
    const failedCancel = await fixture.service.apply(cancelPlan.plan);
    expect(failedCancel).toMatchObject({ ok: false, operation: { state: "incomplete" } });
    if (failedCancel.ok || failedCancel.operation === undefined) return;
    const operationPath = join(
      fixture.stateDir,
      "scope-onboarding",
      `${cancelPlan.plan.operationId}.json`,
    );
    writeFileSync(operationPath, JSON.stringify({
      ...failedCancel.operation,
      state: "applying",
    }, null, 2));

    const restarted = fixture.restartService();
    expect(await restarted.cancel(cancelPlan.plan.operationId)).toMatchObject({
      ok: true,
      operation: { state: "cancelled" },
    });
    expect(restarted.isActivationAllowed(cancelRegistration.scope.scopeId)).toBe(true);
    expect(fixture.lifecycle.getHostingState(cancelRegistration.scope.scopeId)).toBe("hosted");
    await fixture.close();
  });

  it("restores pre-existing authority before startup reopens an interrupted scope", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "existing-authority-crash");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const registration = await fixture.lifecycle.registerDirectoryScope({ directoryRoot: target });
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    let authorityCommitted!: () => void;
    const committed = new Promise<void>((resolve) => {
      authorityCommitted = resolve;
    });
    const applyAuthority = fixture.authority.applyTransactional.bind(fixture.authority);
    const authoritySpy = vi.spyOn(fixture.authority, "applyTransactional")
      .mockImplementationOnce(async (...args) => {
        await applyAuthority(...args);
        authorityCommitted();
        return new Promise<never>(() => {});
      });

    void fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );
    await committed;
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      state: "applying",
      registeredByOperation: false,
      authorityApplied: null,
    });
    expect(fixture.authority.inspect(planned.plan.scopeId)).toMatchObject({
      trust: { trusted: true },
      resolvedPolicy: { writes: { mode: "scope-directory" } },
    });
    authoritySpy.mockRestore();

    const restarted = fixture.restartService();
    expect(await restarted.recoverForStartup(planned.plan.scopeId)).toBe(true);
    expect(await restarted.status(planned.plan.operationId)).toMatchObject({
      state: "incomplete",
      authorityApplied: null,
      readiness: {
        registered: true,
        trusted: false,
        workflowReady: false,
        partiallyApplied: false,
      },
      error: { code: "startup_recovered" },
    });
    expect(fixture.authority.inspect(planned.plan.scopeId)).toMatchObject({
      trust: { trusted: false },
      policyFragment: null,
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("hosted");
    await fixture.close();
  });

  it("resumes after restart between registry persistence and registration checkpoint", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "restart-registration");
    mkdirSync(target);
    execFileSync("git", ["init", "--quiet"], { cwd: target });
    const planned = await fixture.service.plan(target, {
      trust: true,
      initialAutomationMode: "supervised",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    let registrationPrepared!: () => void;
    const prepared = new Promise<void>((resolve) => {
      registrationPrepared = resolve;
    });
    const prepareRegistration = fixture.lifecycle.prepareDirectoryScopeRegistration.bind(
      fixture.lifecycle,
    );
    const prepareSpy = vi.spyOn(
      fixture.lifecycle,
      "prepareDirectoryScopeRegistration",
    ).mockImplementationOnce(async (input) => {
      await prepareRegistration(input);
      registrationPrepared();
      return new Promise<never>(() => {});
    });

    void fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );
    await prepared;
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      state: "applying",
      registeredByOperation: true,
      readiness: {
        registered: true,
        configured: true,
        workflowReady: false,
        blocked: true,
        partiallyApplied: true,
      },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("inactive");
    prepareSpy.mockRestore();

    const restarted = fixture.restartService();
    expect(await restarted.status(planned.plan.operationId)).toMatchObject({
      state: "applying",
      registeredByOperation: true,
      readiness: { registered: true, partiallyApplied: true },
    });
    const persisted = JSON.parse(readFileSync(join(
      fixture.stateDir,
      "scope-onboarding",
      `${planned.plan.operationId}.json`,
    ), "utf8")) as { readiness: { registered: boolean; partiallyApplied: boolean } };
    expect(persisted.readiness).toMatchObject({ registered: true, partiallyApplied: true });

    const retried = await restarted.retry(
      planned.plan.operationId,
      operatorAction(fixture.authorityConfigPath, true),
    );
    expect(retried).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        readiness: { workflowReady: true, blocked: false },
      },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("hosted");
    await fixture.close();
  });

  it("keeps cancellation incomplete when registry rollback fails", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "rollback-failure");
    mkdirSync(join(target, ".kota"), { recursive: true });
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const rollbackSpy = vi.spyOn(fixture.lifecycle, "rollbackPreparedScope")
      .mockResolvedValue({
        ok: false,
        reason: "rollback_failed",
        message: "fixture registry rollback failed",
        scopeId: planned.plan.scopeId,
      });

    const failedApply = await fixture.service.apply(planned.plan);
    expect(failedApply).toMatchObject({
      ok: false,
      reason: "rollback_failed",
      operation: {
        state: "incomplete",
        registeredByOperation: true,
        readiness: { partiallyApplied: true, blocked: true },
      },
    });
    const cancelled = await fixture.service.cancel(planned.plan.operationId);
    expect(cancelled).toMatchObject({
      ok: false,
      reason: "rollback_failed",
      operation: {
        state: "incomplete",
        error: { code: "rollback_failed" },
        readiness: { partiallyApplied: true, blocked: true },
      },
    });
    if (cancelled.ok) throw new Error("rollback failure fixture unexpectedly cancelled");
    expect(await fixture.service.status(planned.plan.operationId)).toEqual(cancelled.operation);
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("inactive");
    rollbackSpy.mockRestore();
    await fixture.close();
  });

  it("rejects accepted plans when machine authority changes concurrently", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "authority-drift");
    mkdirSync(target);
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const registeredDefault = fixture.registry.getDefaultScopeId();
    const changed = await fixture.authority.apply(registeredDefault, {
      expectedRevision: planned.plan.authorityBaseline.revision,
      reason: "Concurrent operator authority change.",
      policy: {
        scopeId: registeredDefault,
        reason: "Bind onboarding plans to the inspected authority revision.",
        writes: { mode: "none" },
      },
    }, operatorAction(fixture.authorityConfigPath, false));
    expect(changed.ok).toBe(true);
    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false,
      reason: "plan_changed",
    });
    await fixture.close();
  });
});

async function createFixture(
  overrides: Pick<
    ConstructorParameters<typeof ScopeOnboardingService>[0],
    "createRuntimeDirectory"
  > = {},
): Promise<{
  root: string;
  stateDir: string;
  authorityConfigPath: string;
  authority: ScopeAuthorityService;
  bus: EventBus;
  registry: ScopeRegistry;
  runState: RunStateDatabase;
  service: ScopeOnboardingService;
  host: ScopeRuntimeHost;
  lifecycle: ScopeLifecycleService;
  missingSetupRoots: Set<string>;
  workflowProbeFailureScopes: Set<string>;
  onboardingTransitions: string[];
  restartService: () => ScopeOnboardingService;
  close: () => Promise<void>;
}> {
  const root = temporaryRoot("fixture");
  const defaultScope = join(root, "default-scope");
  const stateDir = join(root, "state");
  const authorityConfigPath = join(root, "machine", "config.json");
  mkdirSync(defaultScope, { recursive: true });
  const bus = new EventBus();
  const onboardingTransitions: string[] = [];
  bus.on("scope.lifecycle.changed", (payload) => {
    if (payload.transition === "onboarding-completed") {
      onboardingTransitions.push(payload.transition);
    }
  });
  const registry = new ScopeRegistry({ stateDir, scopes: [{ scopeRoot: defaultScope }] });
  const runState = new RunStateDatabase(join(stateDir, "run-state"));
  const startedAt = new Date().toISOString();
  const initial = registry.getDefault();
  runState.registerScope({
    id: initial.scopeId,
    rootPath: initial.scopeRoot,
    displayName: initial.displayName,
    createdAt: startedAt,
  });
  const daemonEpoch = runState.beginDaemonSession(startedAt).epoch;
  let runtimes!: ScopeRuntimeRegistry;
  const coordinator = new RunCoordinator({
    store: runState,
    daemonEpoch,
    concurrency: 2,
    execute: (run, signal) =>
      runtimes.get(run.scopeId).workflowRuntime.executeAdmittedRun(run, signal),
  });
  runtimes = ScopeRuntimeRegistry.create({
    registry,
    authorityConfigPath,
    bus,
    workflows: [
      registerWorkflowDefinition("test/scope-improvement-onboarding.ts", {
        repository: "none",
        name: "scope-improvement-onboarding",
        triggers: [{ event: "scope.lifecycle.changed" }],
        steps: [{ id: "noop", type: "code", run: () => "ok" }],
      }),
      registerWorkflowDefinition("test/scope-improver.ts", {
        repository: "write",
        integration: { validationCommand: ["true"] },
        name: "scope-improver",
        triggers: [{ event: "test.onboarding.ready" }],
        steps: [{ id: "noop", type: "code", run: () => "ok" }],
      }),
    ],
    idleIntervalMs: 60_000,
    onLog: () => {},
    runState,
    runCoordinator: coordinator,
    daemonEpoch,
  });
  const host = new ScopeRuntimeHost({
    bus,
    pollIntervalMs: 60_000,
    onDueItems: () => {},
  });
  await host.startInitial(runtimes);
  const lifecycle = new ScopeLifecycleService({
    registry,
    runState,
    runtimes,
    runtimeHost: host,
    bus,
    listSessionIds: () => [],
    inspectExternalBlockers: () => [],
  });
  const authority = new ScopeAuthorityService(
    new ScopeAuthorityStore(authorityConfigPath),
    registry,
  );
  const missingSetupRoots = new Set<string>();
  const workflowProbeFailureScopes = new Set<string>();
  const serviceOptions = {
    stateDir,
    registry,
    lifecycle,
    authority,
    getSetupStatus: async (directoryRoot) => ({
      visibility: "full",
      requirements: missingSetupRoots.has(directoryRoot)
        ? [{
            moduleName: "fixture-provider",
            requirementId: "credentials",
            kind: "config",
            title: "Fixture credentials",
            required: true,
            scope: "scope",
            sensitivity: "none",
            setup: { mode: "none" },
            state: "missing",
            reason: "not_configured",
            message: "Configure fixture credentials before this capability can run.",
          }]
        : [],
      summary: {
        ready: 0,
        missing: 0,
        pending: 0,
        expired: 0,
        revoked: 0,
        unknown: 0,
        unavailable: 0,
      },
    }),
    isInitialImprovementAvailable: (scopeId) => {
      if (workflowProbeFailureScopes.has(scopeId)) {
        throw new Error("fixture scope-improver readiness probe failed");
      }
      const enabled = new Set(
        runtimes.get(scopeId).workflowRuntime.getDefinitions()
          .filter((definition) => definition.enabled)
          .map((definition) => definition.name),
      );
      return enabled.has("scope-improvement-onboarding") && enabled.has("scope-improver");
    },
    ...overrides,
  } satisfies ConstructorParameters<typeof ScopeOnboardingService>[0];
  const service = new ScopeOnboardingService(serviceOptions);
  return {
    root,
    stateDir,
    authorityConfigPath,
    authority,
    bus,
    registry,
    runState,
    service,
    host,
    lifecycle,
    missingSetupRoots,
    workflowProbeFailureScopes,
    onboardingTransitions,
    restartService: () => new ScopeOnboardingService(serviceOptions),
    close: async () => {
      await host.stopAll(runtimes, 0);
      runState.close();
    },
  };
}

function temporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `kota-scope-onboarding-${label}-`));
  roots.push(root);
  return root;
}

function listRuntimeDirectories(scopeRoot: string): string[] {
  const directories: string[] = [];
  const visit = (relativePath: string): void => {
    const absolutePath = join(scopeRoot, relativePath);
    if (!existsSync(absolutePath)) return;
    directories.push(relativePath);
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(relativePath, entry.name));
    }
  };
  visit(".kota");
  return directories.sort();
}

function operatorAction(
  authorityConfigPath: string,
  confirmedDangerousChange: boolean,
): ScopeAuthorityOperatorAction {
  const verifier = createScopeAuthorityOperatorTokenVerifier(authorityConfigPath);
  const request = {
    value: confirmedDangerousChange ? "confirm-dangerous" as const : "apply" as const,
    scopeId: "scope-onboarding-test",
    body: "{}",
    challenge: "a".repeat(64),
  };
  const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
  const priorSessionId = process.env.KOTA_SESSION_ID;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH =
    scopeAuthorityOperatorTokenPath(authorityConfigPath);
  delete process.env.KOTA_SESSION_ID;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    const signed = scopeAuthorityOperatorHeadersForInteractiveClient(
      request,
      verifier.answerChallenge(request.challenge),
    );
    if (!signed.ok) throw new Error(signed.message);
    const action = verifier.authorize(
      request,
      signed.headers[SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER],
    );
    if (action === undefined) throw new Error("fixture operator action was not authorized");
    return action;
  } finally {
    if (ttyDescriptor === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    if (priorTokenPath === undefined) delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    else process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorTokenPath;
    if (priorSessionId === undefined) delete process.env.KOTA_SESSION_ID;
    else process.env.KOTA_SESSION_ID = priorSessionId;
  }
}
