import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
import type { ScopeImprovementAuthorityProjection } from "./scope-improvement-authority-provider.js";
import { ScopeLifecycleService } from "./scope-lifecycle.js";
import {
  type ScopeOnboardingChoices,
  type ScopeOnboardingOperation,
  ScopeOnboardingService,
} from "./scope-onboarding.js";
import { mutateAnchoredScopeRuntimeDirectories } from "./scope-onboarding-runtime-directory.js";
import { SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE } from "./scope-onboarding-runtime-directory-helper-source.js";
import { ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeRegistry } from "./scope-runtime.js";
import { ScopeRuntimeHost } from "./scope-runtime-host.js";

afterEach(() => vi.restoreAllMocks());

function initializeGitRepository(root: string): void {
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=kota@example.test",
      "-c",
      "user.name=KOTA Test",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "Initial commit",
    ],
    { cwd: root },
  );
}

describe("ScopeOnboardingService", () => {
  it.each([
    ["observe", "passive", "owner-questions", "disabled"],
    ["propose", "supervised", "task-proposals", "disabled"],
    ["build", "autonomous", "task-proposals", "enabled"],
  ] as const)("resolves %s into the existing authority rails", async (posture, autonomy, review, builder) => {
    const fixture = await createFixture();
    const target = join(fixture.root, "postures");
    mkdirSync(target);
    initializeGitRepository(target);
    const writes = posture === "observe"
      ? { mode: "none" as const }
      : { mode: "scope-directory" as const };
    expect(await fixture.service.plan(target, {
      trust: true, improvementPosture: posture, writes,
    })).toMatchObject({
      ok: true,
      plan: { permissions: { autonomy, writes, improvement: { posture, review, builder } } },
    });
  });

  it("rejects build authority without explicit trust", async () => {
    const fixture = await createFixture();
    expect(await fixture.service.plan(fixture.root, {
      improvementPosture: "build", writes: { mode: "scope-directory" },
    })).toMatchObject({ ok: false, reason: "invalid_choices" });
  });

  it.each([
    ["unborn Git repository", "repository_commit_unavailable"],
    ["excluded task queue", "scope_improver_write_denied"],
    ["malformed improvement configuration", "scope_improvement_inspection_failed"],
    ["failed workflow probe", "workflow_inspection_failed"],
  ] as const)("keeps activation closed for %s", async (_scenario, reason) => {
    const fixture = await createFixture(reason === "scope_improvement_inspection_failed"
      ? { getImprovementAuthority: () => { throw new Error("Malformed improvement config"); } }
      : {});
    const target = join(fixture.root, "parked");
    mkdirSync(target);
    if (reason === "repository_commit_unavailable") {
      execFileSync("git", ["init", "--quiet"], { cwd: target });
    } else {
      initializeGitRepository(target);
    }
    const choices: ScopeOnboardingChoices = {
      trust: true, improvementPosture: "propose",
      writes: reason === "scope_improver_write_denied"
        ? { mode: "paths", paths: ["src"] }
        : { mode: "scope-directory" },
    };
    const planned = await fixture.service.plan(target, choices);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    if (reason === "workflow_inspection_failed") {
      fixture.workflowProbeFailureScopes.add(planned.plan.scopeId);
    }
    expect(await fixture.service.apply(
      planned.plan, operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true, operation: {
        state: "succeeded",
        readiness: {
          registered: true, workflowReady: false, blocked: true,
          reasons: expect.arrayContaining([expect.objectContaining({ code: reason })]),
        },
      },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("inactive");
    expect(fixture.service.isActivationAllowed(planned.plan.scopeId)).toBe(false);
    expect(fixture.runState.listRuns(planned.plan.scopeId)).toEqual([]);
    expect(fixture.onboardingTransitions).toEqual([]);
  });

  it("parks a build scope on builder runtime readiness without blocking an observe sibling", async () => {
    const fixture = await createFixture({
      inspectImprovementRuntimeReadiness: (_scopeId, posture) =>
        posture === "build"
          ? [
              {
                code: "builder_provider_unavailable",
                capability: "builder.fixture-provider",
                message: "The builder provider is not configured.",
              },
              {
                code: "builder_harness_unavailable",
                capability: "builder.fixture-harness",
                message: "The builder harness is not authenticated.",
              },
            ]
          : [],
    });
    const buildTarget = join(fixture.root, "builder-provider-missing");
    const observeTarget = join(fixture.root, "healthy-observe-sibling");
    mkdirSync(buildTarget);
    mkdirSync(observeTarget);
    initializeGitRepository(buildTarget);
    const buildPlan = await fixture.service.plan(buildTarget, {
      trust: true,
      improvementPosture: "build",
      writes: { mode: "scope-directory" },
    });
    expect(buildPlan.ok).toBe(true);
    if (!buildPlan.ok) return;

    expect(await fixture.service.apply(
      buildPlan.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: {
        readiness: {
          workflowReady: false,
          blocked: true,
          reasons: expect.arrayContaining([
            expect.objectContaining({
              code: "builder_provider_unavailable",
              capability: "builder.fixture-provider",
            }),
            expect.objectContaining({
              code: "builder_harness_unavailable",
              capability: "builder.fixture-harness",
            }),
          ]),
        },
      },
    });
    expect(fixture.lifecycle.getHostingState(buildPlan.plan.scopeId)).toBe("inactive");
    expect(fixture.runState.listRuns(buildPlan.plan.scopeId)).toEqual([]);

    const observePlan = await fixture.service.plan(observeTarget, { trust: true });
    expect(observePlan.ok).toBe(true);
    if (!observePlan.ok) return;
    expect(await fixture.service.apply(
      observePlan.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: { readiness: { workflowReady: true, blocked: false } },
    });
    expect(fixture.lifecycle.getHostingState(observePlan.plan.scopeId)).toBe("hosted");
  });

  it("parks disabled improvement onboarding and activates it after configuration recovers", async () => {
    let improvementEnabled = false;
    const fixture = await createFixture({
      getImprovementAuthority: (_scopeRoot, _stateDir, _policy) => ({
        enabled: improvementEnabled,
        configuredPosture: "build",
        posture: "build",
        review: improvementEnabled ? "task-proposals" : "disabled",
        builder: improvementEnabled ? "enabled" : "disabled",
        taskProposalDecision: { outcome: "allow", reason: "fixture task authority" },
        builderDecision: { outcome: "allow", reason: "fixture builder authority" },
      }),
    });
    const target = join(fixture.root, "disabled-improvement");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
      improvementPosture: "build",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: {
        readiness: {
          workflowReady: false,
          improvement: { review: "disabled", builder: "disabled" },
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "scope_improvement_disabled" }),
          ]),
        },
      },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("inactive");
    expect(fixture.onboardingTransitions).toEqual([]);

    improvementEnabled = true;
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      readiness: {
        workflowReady: true,
        blocked: false,
        improvement: { posture: "build", builder: "enabled" },
      },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("hosted");
    expect(fixture.onboardingTransitions).toEqual(["onboarding-completed"]);
  });

  it.each([
    ["parked observe to task-denied build", "observe", "build", false],
    ["parked build to observe", "build", "observe", false],
    ["active build to observe", "build", "observe", true],
  ] as const)("projects current authority for %s", async (_scenario, before, after, initiallyEnabled) => {
    let projection: ScopeImprovementAuthorityProjection = {
      enabled: initiallyEnabled,
      configuredPosture: before, posture: before,
      review: initiallyEnabled ? "task-proposals" : "disabled",
      builder: initiallyEnabled ? "enabled" : "disabled",
      taskProposalDecision: { outcome: "allow", reason: "Initial task-queue grant" },
      builderDecision: { outcome: "allow", reason: "Initial builder grant" },
    };
    const provider = vi.fn(() => projection);
    const fixture = await createFixture({ getImprovementAuthority: provider });
    const target = join(fixture.root, "changed-authority");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true, improvementPosture: before,
      writes: before === "observe" ? { mode: "none" } : { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(await fixture.service.apply(
      planned.plan, operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true, operation: { readiness: { workflowReady: initiallyEnabled } },
    });
    const writes = after === "observe"
      ? { mode: "none" as const }
      : { mode: "paths" as const, paths: ["src"] };
    const autonomy = after === "observe" ? "passive" : "autonomous";
    expect(await fixture.authority.apply(planned.plan.scopeId, {
      expectedRevision: fixture.authority.currentRevision(), trust: true,
      reason: "Revise accepted scope authority",
      policy: {
        scopeId: planned.plan.scopeId, reason: "Current scope authority",
        autonomy: { defaultMode: autonomy, maxMode: autonomy }, writes,
      },
    }, operatorAction(fixture.authorityConfigPath, after === "build"))).toMatchObject({ ok: true });
    projection = {
      enabled: true, configuredPosture: after, posture: after,
      review: after === "observe" ? "owner-questions" : "task-proposals",
      builder: after === "observe" ? "disabled" : "enabled",
      taskProposalDecision: { outcome: "deny", reason: "Current authority excludes task writes" },
      builderDecision: {
        outcome: after === "observe" ? "deny" : "allow", reason: "Current builder authority",
      },
    };
    if (after === "observe") rmSync(join(target, ".git"), { recursive: true });
    const ready = after === "observe";
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      readiness: {
        workflowReady: ready, blocked: !ready,
        improvement: {
          posture: after, review: projection.review, builder: projection.builder,
          autonomyMode: autonomy, writes,
        },
        reasons: ready ? [] : expect.arrayContaining([
          expect.objectContaining({ code: "scope_improver_write_denied" }),
        ]),
      },
    });
    expect(provider).toHaveBeenLastCalledWith(target, join(target, ".kota"),
      expect.objectContaining({
        writes: expect.objectContaining(writes),
        autonomy: expect.objectContaining({ defaultMode: autonomy, maxMode: autonomy }),
      }));
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe(ready ? "hosted" : "inactive");
    expect(fixture.onboardingTransitions).toEqual(ready ? ["onboarding-completed"] : []);
  });

  it("onboards repositories and empty directories through one resumable transaction", async () => {
    const fixture = await createFixture();
    const repository = join(fixture.root, "repository");
    const emptyDirectory = join(fixture.root, "notes");
    mkdirSync(repository, { recursive: true });
    initializeGitRepository(repository);
    mkdirSync(join(emptyDirectory, ".kota"), { recursive: true });
    writeFileSync(join(repository, "AGENTS.md"), "# Repository guidance\n");
    writeFileSync(
      join(emptyDirectory, ".kota", "config.json"),
      JSON.stringify({ guardrails: { policies: { dangerous: "allow" } } }),
    );
    fixture.missingSetupRoots.add(emptyDirectory);

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
      improvementPosture: "propose",
      writes: { mode: "scope-directory" },
    });
    expect(repositoryPlan.ok).toBe(true);
    if (!repositoryPlan.ok) return;
    expect(repositoryPlan.plan.permissions).toEqual({
      trusted: true,
      autonomy: "supervised",
      writes: { mode: "scope-directory" },
      improvement: {
        posture: "propose",
        review: "task-proposals",
        builder: "disabled",
      },
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


    const duplicateApply = await fixture.service.apply(
      repositoryPlan.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );
    expect(duplicateApply).toMatchObject({
      ok: true, operation: {
        operationId: repositoryApplied.operation.operationId,
        attempts: repositoryApplied.operation.attempts,
        mutations: repositoryApplied.operation.mutations,
        readiness: repositoryApplied.operation.readiness,
      },
    });
    expect(fixture.authority.inspect(repositoryPlan.plan.scopeId)).toMatchObject({
      audit: [expect.objectContaining({ revision: 1 })],
    });
    expect((await fixture.service.inspect(repository)).registered).toBe(true);

    const emptyInspection = await fixture.service.inspect(emptyDirectory);
    expect(emptyInspection).toMatchObject({
      kind: "directory",
      registered: false,
      existing: { kotaState: true, scopeConfig: true, taskQueue: false },
      blockers: [],
      setup: [expect.objectContaining({ state: "missing" })],
    });
    const emptyPlan = await fixture.service.plan(emptyDirectory);
    expect(emptyPlan.ok).toBe(true);
    if (!emptyPlan.ok) return;
    expect(emptyPlan.plan.permissions).toEqual({
      trusted: false,
      autonomy: "passive",
      writes: { mode: "none" },
      improvement: {
        posture: "observe",
        review: "owner-questions",
        builder: "disabled",
      },
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
      existsSync(join(emptyDirectory, path))
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
        ]),
      },
    });
    expect(fixture.lifecycle.getHostingState(emptyPlan.plan.scopeId)).toBe("inactive");
    expect(fixture.service.isActivationAllowed(emptyPlan.plan.scopeId)).toBe(false);
    expect(fixture.runState.listRuns(emptyPlan.plan.scopeId)).toEqual([]);
    expect(retried.operation.mutations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "activate-scope" }),
    ]));
    expect(fixture.host.hostedCount()).toBe(3);

    expect(await fixture.service.status(emptyPlan.plan.operationId)).toMatchObject({
      state: "succeeded", attempts: 2, readiness: retried.operation.readiness,
    });
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
  });

  it("keeps unrelated module setup visible without blocking the selected scope chain", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "optional-capability-setup");
    mkdirSync(target);
    fixture.missingSetupRoots.add(realpathSync.native(target));

    const inspection = await fixture.service.inspect(target);
    expect(inspection).toMatchObject({
      setup: [expect.objectContaining({
        moduleName: "fixture-provider",
        state: "missing",
      })],
      blockers: [],
    });
    const planned = await fixture.service.plan(target, {
      trust: true,
      improvementPosture: "observe",
      writes: { mode: "none" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        readiness: { workflowReady: true, blocked: false },
      },
    });
  });

  it("rejects a nested Git directory whose writer sandbox would escape the scope", async () => {
    const fixture = await createFixture();
    const repositoryRoot = join(fixture.root, "repository-with-nested-scope");
    const nestedDirectory = join(repositoryRoot, "selected-directory");
    mkdirSync(nestedDirectory, { recursive: true });
    initializeGitRepository(repositoryRoot);

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
      improvementPosture: "propose",
      writes: { mode: "scope-directory" },
    })).toMatchObject({
      ok: false,
      reason: "invalid_directory",
      message: expect.stringContaining(repositoryRoot),
    });
    expect(fixture.registry.getByRoot(nestedDirectory)).toBeUndefined();
    expect(existsSync(join(nestedDirectory, ".kota"))).toBe(false);
  });

  it("leaves task-queue directory creation to the repo-task domain", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "target");
    mkdirSync(join(target, "data"), { recursive: true });
    writeFileSync(join(target, "data", "tasks"), "not a directory");
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, false),
    )).toMatchObject({ ok: true });
    expect(readFileSync(join(target, "data", "tasks"), "utf8")).toBe("not a directory");
  });

  it("does not delete an ambiguously owned directory after a write-ahead crash", async () => {
    let fixture!: Awaited<ReturnType<typeof createFixture>>;
    let crashCheckpoint: ScopeOnboardingOperation | null = null;
    let checkpointObservedBeforeCreation = false;
    fixture = await createFixture({
      mutateRuntimeDirectories: (mutations) => {
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
        mutateAnchoredScopeRuntimeDirectories(mutations);
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
    expect(existsSync(join(target, ".kota"))).toBe(true);
    if (crashCheckpoint === null) throw new Error("fixture did not capture the crash checkpoint");

    const operationPath = join(
      fixture.stateDir,
      "scope-onboarding",
      `${planned.plan.operationId}.json`,
    );
    writeFileSync(operationPath, JSON.stringify(crashCheckpoint, null, 2));

    expect(await fixture.restartService().cancel(planned.plan.operationId)).toMatchObject({
      ok: true,
      operation: { state: "cancelled" },
    });
    expect(existsSync(join(target, ".kota"))).toBe(true);
  });

  it("cancels legacy schema-two ownership and accepts a fresh identity-bound plan", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "legacy-schema-two-runtime-ownership");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
      improvementPosture: "propose",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const interrupted = await fixture.service.apply(planned.plan);
    expect(interrupted).toMatchObject({
      ok: false,
      reason: "operator_action_required",
      operation: { state: "incomplete" },
    });
    if (interrupted.ok || interrupted.operation === undefined) return;
    const operationPath = join(
      fixture.stateDir,
      "scope-onboarding",
      `${planned.plan.operationId}.json`,
    );
    const legacyOperation = structuredClone(interrupted.operation);
    delete legacyOperation.acceptedPlan.directoryRootIdentity;
    for (const change of legacyOperation.acceptedPlan.changes) {
      if (change.owner !== "scope") continue;
      mkdirSync(join(target, change.path), { recursive: true });
      legacyOperation.mutations = [...legacyOperation.mutations, {
        kind: "create-runtime-directory",
        target: change.path,
        status: "applied",
        at: "2026-01-01T00:00:00.000Z",
      }];
    }
    writeFileSync(operationPath, JSON.stringify(legacyOperation, null, 2));

    const restarted = fixture.restartService();
    expect(await restarted.cancel(planned.plan.operationId)).toMatchObject({
      ok: true,
      operation: {
        state: "cancelled",
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "rollback",
            target: "runtime-directory:.kota",
            status: "rolled-back",
          }),
        ]),
      },
    });
    expect(existsSync(join(target, ".kota"))).toBe(true);

    const freshPlan = await restarted.plan(target, planned.plan.choices);
    expect(freshPlan.ok).toBe(true);
    if (!freshPlan.ok) return;
    expect(freshPlan.plan.directoryRootIdentity).toMatchObject({
      dev: expect.any(Number),
      ino: expect.any(Number),
    });
    expect(await restarted.apply(
      freshPlan.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({ ok: true, operation: { state: "succeeded" } });
  });

  it("migrates schema-one supervised operations before retry without widening authority", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "legacy-supervised-retry");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
      improvementPosture: "propose",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const interrupted = await fixture.service.apply(planned.plan);
    expect(interrupted).toMatchObject({
      ok: false,
      reason: "operator_action_required",
      operation: { state: "incomplete" },
    });
    if (interrupted.ok || interrupted.operation === undefined) return;
    const operationPath = join(
      fixture.stateDir,
      "scope-onboarding",
      `${planned.plan.operationId}.json`,
    );
    writeFileSync(
      operationPath,
      JSON.stringify(asLegacySupervisedOperation(interrupted.operation), null, 2),
    );

    const retained = join(target, ".kota", "owner-questions", "retained.json");
    writeFileSync(retained, '{"question":"preserve"}');
    const retried = await fixture.restartService().retry(
      planned.plan.operationId,
      operatorAction(fixture.authorityConfigPath, true),
    );
    expect(retried).toMatchObject({
      ok: true,
      operation: {
        schema: 2,
        acceptedPlan: {
          schema: 2,
          choices: { improvementPosture: "propose" },
          permissions: {
            autonomy: "supervised",
            improvement: { posture: "propose", builder: "disabled" },
          },
        },
        readiness: {
          improvement: {
            posture: "propose",
            autonomyMode: "supervised",
            builder: "disabled",
          },
        },
      },
    });
    expect(fixture.authority.inspect(planned.plan.scopeId)).toMatchObject({
      resolvedPolicy: {
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
      },
    });
    const persisted = readFileSync(operationPath, "utf8");
    expect(JSON.parse(persisted)).toMatchObject({
      schema: 2,
      acceptedPlan: {
        schema: 2,
        choices: { improvementPosture: "propose" },
      },
    });
    expect(persisted).not.toContain("initialAutomationMode");
    expect(readFileSync(retained, "utf8")).toBe('{"question":"preserve"}');
  });

  it("rejects directories created after an unsuccessful initialization attempt", async () => {
    const mutate = vi.fn(mutateAnchoredScopeRuntimeDirectories)
      .mockImplementationOnce(() => { throw new Error("Filesystem helper unavailable"); });
    const fixture = await createFixture({ mutateRuntimeDirectories: mutate });
    const target = join(fixture.root, "concurrent-directory");
    mkdirSync(target);
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false, reason: "apply_failed",
    });
    mkdirSync(join(target, ".kota"));
    writeFileSync(join(target, ".kota", "sentinel"), "operator state");
    expect(await fixture.restartService().retry(
      planned.plan.operationId, operatorAction(fixture.authorityConfigPath, false),
    )).toMatchObject({ ok: false, reason: "plan_changed" });
    expect(readFileSync(join(target, ".kota", "sentinel"), "utf8")).toBe("operator state");
    expect(fixture.registry.get(planned.plan.scopeId)).toBeUndefined();
    expect(fixture.authority.currentRevision()).toBe(0);
  });

  it("rejects a retained directory replaced by a symlink before retry", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "retry-symlink");
    const outside = join(fixture.root, "outside");
    mkdirSync(target);
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel"), "outside state");
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false, reason: "operator_action_required",
    });
    rmSync(join(target, ".kota", "runs"), { recursive: true });
    symlinkSync(outside, join(target, ".kota", "runs"), "dir");
    expect(await fixture.restartService().retry(
      planned.plan.operationId, operatorAction(fixture.authorityConfigPath, false),
    )).toMatchObject({ ok: false, reason: "apply_failed" });
    expect(readdirSync(outside)).toEqual(["sentinel"]);
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("outside state");
    expect(fixture.registry.get(planned.plan.scopeId)).toBeUndefined();
    expect(fixture.authority.currentRevision()).toBe(0);
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
  });

  it("reactivates from a fresh plan after removing an originally registered partial scope", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "removed-scope");
    mkdirSync(target);
    initializeGitRepository(target);
    fixture.missingSetupRoots.add(target);
    const existingRegistration = await fixture.lifecycle.registerDirectoryScope({
      directoryRoot: target,
      displayName: "Existing scope",
    });
    expect(existingRegistration).toMatchObject({ ok: true, status: "registered" });
    if (!existingRegistration.ok) return;
    const planned = await fixture.service.plan(target, {
      trust: true,
      improvementPosture: "propose",
      writes: { mode: "scope-directory" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    fixture.workflowProbeFailureScopes.add(planned.plan.scopeId);
    expect(planned.plan.registrationBaseline).toMatchObject({
      registered: true,
      displayName: "Existing scope",
      hostingState: "hosted",
    });

    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: { state: "succeeded", attempts: 1 },
    });
    const retainedState = join(target, ".kota", "retained.json");
    writeFileSync(retainedState, "operator-owned\n");
    await vi.waitFor(() => {
      expect(fixture.runState.listRuns(
        planned.plan.scopeId,
        ["queued", "running", "integrating"],
      )).toEqual([]);
    });
    expect(fixture.disableWorkflow(
      planned.plan.scopeId,
      "scope-improvement-onboarding",
    )).toEqual({ ok: true });
    const drained = await fixture.lifecycle.drainScope(planned.plan.scopeId);
    if (!drained.ok) throw new Error(JSON.stringify(drained));
    expect(drained).toMatchObject({
      ok: true,
      status: "drained",
    });
    expect(await fixture.lifecycle.removeScope(planned.plan.scopeId)).toMatchObject({
      ok: true,
      status: "removed",
    });
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      state: "succeeded",
      readiness: { registered: false },
    });
    expect(await fixture.service.inspect(target)).toMatchObject({
      registered: false,
      trust: { trusted: true, source: "machine-config" },
      policyRevision: planned.plan.authorityBaseline.revision + 1,
      policyFragment: {
        scopeId: planned.plan.scopeId,
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
        writes: { mode: "scope-directory" },
      },
    });
    const missingAfterRemoval = join(target, ".kota", "owner-questions");
    rmSync(missingAfterRemoval, { recursive: true, force: true });

    expect(await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: false,
      reason: "plan_changed",
    });
    fixture.workflowProbeFailureScopes.delete(planned.plan.scopeId);
    const reactivation = await fixture.service.plan(target, planned.plan.choices);
    expect(reactivation.ok).toBe(true);
    if (!reactivation.ok) return;
    expect(reactivation.plan.registrationBaseline).toMatchObject({
      registered: false,
      displayName: "removed-scope",
      hostingState: null,
    });
    expect(reactivation.plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "register-scope" }),
      expect.objectContaining({
        kind: "create-runtime-directory",
        path: ".kota/owner-questions",
      }),
    ]));

    expect(await fixture.service.apply(
      reactivation.plan,
      operatorAction(fixture.authorityConfigPath, true),
    )).toMatchObject({
      ok: true,
      operation: {
        state: "succeeded",
        attempts: 2,
        readiness: { registered: true },
        mutations: expect.arrayContaining([
          expect.objectContaining({ kind: "reactivate-scope", status: "applied" }),
        ]),
      },
    });
    expect(fixture.registry.get(planned.plan.scopeId)?.scopeRoot).toBe(target);
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      readiness: { workflowReady: true, blocked: false },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("hosted");
    expect(existsSync(missingAfterRemoval)).toBe(true);
    expect(readFileSync(retainedState, "utf8")).toBe("operator-owned\n");
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
    },
  );

  it("does not follow a replaced runtime-directory ancestor during apply or rollback", async () => {
    const targetName = "runtime-ancestor-replacement";
    let target = "";
    let parkedKota = "";
    let outside = "";
    let replaced = false;
    const fixture = await createFixture({
      mutateRuntimeDirectories: (mutations) => {
        const mutation = mutations.find((candidate) =>
          candidate.relativePath === ".kota/runs"
        );
        if (
          !replaced &&
          mutation !== undefined
        ) {
          const kotaMutation = mutations.find((candidate) =>
            candidate.relativePath === ".kota"
          );
          if (kotaMutation === undefined) throw new Error("missing .kota mutation");
          const firstResult = mutateAnchoredScopeRuntimeDirectories([kotaMutation]);
          replaced = true;
          renameSync(join(target, ".kota"), parkedKota);
          symlinkSync(outside, join(target, ".kota"), "dir");
          return [
            ...firstResult,
            ...mutateAnchoredScopeRuntimeDirectories(
              mutations.filter((candidate) => candidate !== kotaMutation),
            ),
          ];
        }
        return mutateAnchoredScopeRuntimeDirectories(mutations);
      },
    });
    target = join(fixture.root, targetName);
    parkedKota = join(target, ".kota-parked");
    outside = join(fixture.root, "outside-runtime-state");
    mkdirSync(target);
    mkdirSync(join(outside, "runs"), { recursive: true });
    writeFileSync(join(outside, "runs", "sentinel"), "outside\n");

    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false,
      reason: "apply_failed",
    });
    expect(replaced).toBe(true);
    expect(readFileSync(join(outside, "runs", "sentinel"), "utf8")).toBe(
      "outside\n",
    );
    expect(existsSync(join(outside, "approvals"))).toBe(false);
    expect(existsSync(join(parkedKota, "runs"))).toBe(false);
  });

  it("does not move a replacement directory while compensating a failed apply", async () => {
    let target = "";
    let parkedCreatedDirectory = "";
    let mutationCalls = 0;
    const fixture = await createFixture({
      mutateRuntimeDirectories: (mutations) => {
        mutationCalls += 1;
        mutateAnchoredScopeRuntimeDirectories(mutations);
        parkedCreatedDirectory = join(target, ".kota", "runs-created-by-onboarding");
        renameSync(join(target, ".kota", "runs"), parkedCreatedDirectory);
        mkdirSync(join(target, ".kota", "runs"));
        writeFileSync(join(target, ".kota", "runs", "sentinel"), "replacement\n");
        throw new Error("fixture failed after replacing the created runtime directory");
      },
    });
    target = join(fixture.root, "runtime-leaf-replacement");
    mkdirSync(target);

    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false,
      reason: "apply_failed",
      operation: {
        mutations: expect.arrayContaining([
          expect.objectContaining({
            kind: "rollback",
            target: "runtime-directory:.kota/runs",
            status: "rolled-back",
            message: expect.stringContaining("without mutating"),
          }),
        ]),
      },
    });
    expect(mutationCalls).toBe(1);
    expect(readFileSync(join(target, ".kota", "runs", "sentinel"), "utf8"))
      .toBe("replacement\n");
    expect(existsSync(parkedCreatedDirectory)).toBe(true);
    expect(readdirSync(target).some((entry) =>
      entry.startsWith(".kota-runtime-directory-quarantine-")
    )).toBe(false);
  });

  it.skipIf(process.platform !== "darwin")("rejects ancestor replacement at the atomic mutation boundary", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kota-atomic-runtime-")));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const target = join(root, "target");
    const outside = join(root, "outside");
    const parkedKota = join(target, ".kota-parked");
    mkdirSync(join(target, ".kota", "runs"), { recursive: true });
    mkdirSync(join(outside, "runs"), { recursive: true });
    writeFileSync(join(outside, "runs", "sentinel"), "outside\n");
    const rootStats = lstatSync(target);
    const boundary =
      "  result = RENAMEATX.call(from_fd, from_path, to_fd, to_path, RENAME_FLAGS)";
    const attackedSource =
      SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE.replace(
        boundary,
        [
          "  unless $ancestor_replaced",
          "    $ancestor_replaced = true",
          `    File.rename(${JSON.stringify(join(target, ".kota"))}, ${JSON.stringify(parkedKota)})`,
          `    File.symlink(${JSON.stringify(outside)}, ${JSON.stringify(join(target, ".kota"))})`,
          "  end",
          boundary,
        ].join("\n"),
      );
    expect(attackedSource).not.toBe(
      SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE,
    );

    const invoke = (
      mutation: Record<string, unknown>,
    ): { ok: boolean; reason?: string } => {
      const result = spawnSync(
        "/usr/bin/ruby",
        ["--disable-gems", "-e", attackedSource],
        {
          encoding: "utf8",
          env: {},
          input: JSON.stringify({
            operation: "ensure",
            scopeRootPath: target,
            scopeRootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
            mutations: [{ operation: "ensure", ...mutation }],
          }),
        },
      );
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout) as { ok: boolean; reason?: string };
    };

    expect(
      invoke({
        relativePath: ".kota/approvals",
        expectMissing: true,
      }),
    ).toMatchObject({ ok: false });
    expect(existsSync(join(outside, "approvals"))).toBe(false);
  });

  it.skipIf(process.platform !== "darwin")("does not follow a moved direct staging leaf during atomic creation", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kota-staging-race-")));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const target = join(root, "target");
    const outside = join(root, "outside");
    const parkedStaging = join(root, "parked-staging");
    mkdirSync(join(target, ".kota"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel"), "outside\n");
    const rootStats = lstatSync(target);
    const boundary =
      "    error = atomic_rename(root_fd, staging_name, root_fd, relative_path)";
    const attackedSource =
      SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE.replace(
        boundary,
        [
          "    unless $staging_replaced",
          "      $staging_replaced = true",
          `      File.rename(File.join(${JSON.stringify(
            target,
          )}, staging_name), ${JSON.stringify(parkedStaging)})`,
          `      File.symlink(${JSON.stringify(outside)}, File.join(${JSON.stringify(
            target,
          )}, staging_name))`,
          "    end",
          boundary,
        ].join("\n"),
      );
    expect(attackedSource).not.toBe(
      SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE,
    );

    const result = spawnSync(
      "/usr/bin/ruby",
      ["--disable-gems", "-e", attackedSource],
      {
        encoding: "utf8",
        env: {},
        input: JSON.stringify({
          operation: "ensure",
          scopeRootPath: target,
          scopeRootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
          mutations: [
            {
              operation: "ensure",
              relativePath: ".kota/runs",
              expectMissing: true,
            },
          ],
        }),
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("outside\n");
    expect(existsSync(join(outside, "runs"))).toBe(false);
    expect(existsSync(parkedStaging)).toBe(true);
  });

  it("rejects a plan after the accepted scope-root inode is replaced", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "replaced-scope-root");
    const acceptedRoot = join(fixture.root, "accepted-scope-root");
    mkdirSync(target);

    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    renameSync(target, acceptedRoot);
    mkdirSync(target);

    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false,
      reason: "plan_changed",
    });
    expect(existsSync(join(target, ".kota"))).toBe(false);
    expect(existsSync(join(acceptedRoot, ".kota"))).toBe(false);
  });

  it("runs observe review without treating an empty .git directory as Git", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "fake-repository");
    mkdirSync(join(target, ".git"), { recursive: true });
    expect(await fixture.service.inspect(target)).toMatchObject({ kind: "directory" });
    const planned = await fixture.service.plan(target, {
      trust: true,
      writes: { mode: "none" },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.blockers).toEqual([]);
    const applied = await fixture.service.apply(
      planned.plan,
      operatorAction(fixture.authorityConfigPath, true),
    );
    expect(applied).toMatchObject({
      ok: true,
      operation: {
        readiness: {
          blocked: false,
          workflowReady: true,
          reasons: [],
          improvement: {
            posture: "observe",
            review: "owner-questions",
            builder: "disabled",
          },
        },
      },
    });
  });

  it("keeps prepared registration closed until authority commits", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "held-apply");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
  });

  it("compensates authority before rolling back a failed activation", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "activation-failure");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
      expect.objectContaining({ scopeId: planned.plan.scopeId, trust: { before: false, after: true } }),
      expect.objectContaining({ scopeId: planned.plan.scopeId, trust: { before: true, after: false } }),
    ]);
    expect(fixture.runState.getScopeIdByRootPath(target)).toBeNull();
    activationSpy.mockRestore();
  });

  it("rolls back onboarding authority after an unrelated scope authority commit", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "activation-failure-after-unrelated-authority");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
  });

  it.each(["status", "retry", "startup"] as const)(
    "publishes newly unblocked onboarding once through %s",
    async (recovery) => {
      const fixture = await createFixture();
      const target = join(fixture.root, "readiness-recovery");
      mkdirSync(target);
      initializeGitRepository(target);
      const planned = await fixture.service.plan(target, {
        trust: true, improvementPosture: "propose", writes: { mode: "scope-directory" },
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const { scopeId, operationId } = planned.plan;
      fixture.workflowProbeFailureScopes.add(scopeId);
      expect(await fixture.service.apply(
        planned.plan, operatorAction(fixture.authorityConfigPath, true),
      )).toMatchObject({
        ok: true, operation: { state: "succeeded", readiness: { workflowReady: false } },
      });
      expect(fixture.lifecycle.getHostingState(scopeId)).toBe("inactive");
      expect(fixture.runState.listRuns(scopeId)).toEqual([]);
      fixture.workflowProbeFailureScopes.delete(scopeId);
      const service = recovery === "startup" ? fixture.restartService() : fixture.service;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (recovery === "startup") expect(await service.recoverForStartup(scopeId)).toBe(true);
        else if (recovery === "retry") {
          expect(await service.retry(operationId)).toMatchObject({ ok: true });
        }
        expect(await service.status(operationId)).toMatchObject({
          state: "succeeded", readiness: { workflowReady: true, blocked: false },
        });
        expect(fixture.lifecycle.getHostingState(scopeId)).toBe("hosted");
        expect(service.isActivationAllowed(scopeId)).toBe(true);
        expect(fixture.onboardingTransitions).toEqual(["onboarding-completed"]);
        expect(fixture.runState.listRuns(scopeId)).toHaveLength(1);
      }
    },
  );

  it("closes and removes an activated runtime when its lifecycle notification fails", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "post-activation-failure");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
  });

  it("refreshes actionable readiness reasons while cancellation is incomplete", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "incomplete-readiness");
    mkdirSync(target);
    const planned = await fixture.service.plan(target);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    fixture.workflowProbeFailureScopes.add(planned.plan.scopeId);
    const rollback = vi.spyOn(fixture.lifecycle, "rollbackPreparedScope").mockResolvedValue({
      ok: false, reason: "rollback_failed", scopeId: planned.plan.scopeId,
      message: "Registry cannot yet release the prepared scope",
    });
    expect(await fixture.service.apply(planned.plan)).toMatchObject({
      ok: false, reason: "rollback_failed",
    });
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      state: "incomplete",
      readiness: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "scope_untrusted" }),
          expect.objectContaining({ code: "workflow_unavailable" }),
          expect.objectContaining({ code: "onboarding_incomplete" }),
        ]),
      },
    });
    rollback.mockRestore();
    expect(await fixture.service.cancel(planned.plan.operationId)).toMatchObject({ ok: true });
  });

  it("applies a planned display name to an existing registration", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "existing-scope");
    mkdirSync(target);
    initializeGitRepository(target);
    const registered = await fixture.lifecycle.registerDirectoryScope({ directoryRoot: target });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const planned = await fixture.service.plan(target, {
      displayName: "Research notes",
      trust: true,
        improvementPosture: "propose",
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
  });

  it("preserves unrelated authority restrictions on an existing scope", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "existing-restricted-scope");
    mkdirSync(target);
    initializeGitRepository(target);
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
      improvementPosture: "observe",
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
  });

  it("retries a write-ahead completion publication without duplicate admission", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "completion-publication-retry");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
  });

  it("restores pre-existing authority before startup reopens an interrupted scope", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "existing-authority-crash");
    mkdirSync(target);
    initializeGitRepository(target);
    const registration = await fixture.lifecycle.registerDirectoryScope({ directoryRoot: target });
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
      authorityApplied: { revision: 1, auditId: expect.any(String) },
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
  });

  it("resumes after restart between registry persistence and registration checkpoint", async () => {
    const fixture = await createFixture();
    const target = join(fixture.root, "restart-registration");
    mkdirSync(target);
    initializeGitRepository(target);
    const planned = await fixture.service.plan(target, {
      trust: true,
        improvementPosture: "propose",
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
    expect(await fixture.service.status(planned.plan.operationId)).toMatchObject({
      state: "incomplete", error: cancelled.operation?.error,
      readiness: { partiallyApplied: true, blocked: true },
    });
    expect(fixture.lifecycle.getHostingState(planned.plan.scopeId)).toBe("inactive");
    rollbackSpy.mockRestore();
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
  });
});

async function createFixture(
  overrides: Partial<Pick<
    ConstructorParameters<typeof ScopeOnboardingService>[0],
    | "mutateRuntimeDirectories"
    | "getImprovementAuthority"
    | "inspectImprovementRuntimeReadiness"
  >> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "kota-scope-onboarding-"));
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
        triggers: [{ event: "scope.lifecycle.changed", filter: { transition: "onboarding-completed" } }],
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
  onTestFinished(async () => {
    await host.stopAll(runtimes, 0);
    runState.close();
    rmSync(root, { recursive: true, force: true });
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
    inspectImprovementRuntimeReadiness: (scopeId) => {
      if (workflowProbeFailureScopes.has(scopeId)) {
        throw new Error("fixture scope-improver readiness probe failed");
      }
      return [];
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
    disableWorkflow: (scopeId: string, workflowName: string) =>
      runtimes.get(scopeId).workflowRuntime.disableWorkflow(workflowName),
    restartService: () => new ScopeOnboardingService(serviceOptions),
  };
}

function asLegacySupervisedOperation(operation: ScopeOnboardingOperation): unknown {
  const { improvementPosture: _choicePosture, ...legacyChoices } =
    operation.acceptedPlan.choices;
  const { improvement: _permissionImprovement, ...legacyPermissions } =
    operation.acceptedPlan.permissions;
  const { improvement: _readinessImprovement, ...legacyReadiness } = operation.readiness;
  return {
    ...operation,
    schema: 1,
    acceptedPlan: {
      ...operation.acceptedPlan,
      schema: 1,
      choices: {
        ...legacyChoices,
        initialAutomationMode: "supervised",
      },
      changes: operation.acceptedPlan.changes.map((change) => {
        if (change.kind !== "set-authority") return change;
        const { improvementPosture: _changePosture, ...legacyChange } = change;
        return { ...legacyChange, initialAutomationMode: "supervised" };
      }),
      permissions: legacyPermissions,
    },
    readiness: legacyReadiness,
  };
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
