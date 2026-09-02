import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  agyCanaryProviderBackoffDurationMs,
  agyCanaryProviderIncidents,
  buildAgyCanaryCommand,
  observedAgyAgentRuns,
} from "./agy-continuous-canary-cli.js";

const roots: string[] = [];

function readCanaryArtifact(
  root: string,
  runId: string,
  phase: "three-hour" | "six-hour",
): Record<string, unknown> {
  const phaseDir = join(
    root,
    ".kota/runs",
    runId,
    "agy-continuous-canary",
    phase,
  );
  const windows = readdirSync(phaseDir);
  expect(windows).toHaveLength(1);
  return JSON.parse(
    readFileSync(join(phaseDir, windows[0]!, "canary.json"), "utf8"),
  ) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workflowStatus(
  backoff = false,
  backoffUpdatedAt = "2026-09-01T02:30:00.000Z",
) {
  return {
    activeRuns: [],
    pendingRuns: [{
      runId: "preserved-run",
      workflowName: "builder",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      enqueuedAtMs: 0,
      notBeforeMs: Number.MAX_SAFE_INTEGER,
    }],
    queueLength: 1,
    completedRuns: 0,
    workflows: {},
    paused: false,
    pause: { paused: false, kind: "none" },
    pendingAbort: false,
    concurrency: 4,
    agentOperatingState: {
      runtimeId: "antigravity-cli:antigravity-cli",
      state: backoff ? "quality-paused" : "idle",
      ...(backoff ? { reason: "successful empty output" } : {}),
    },
    ...(backoff
      ? {
        agentBackoff: {
          runtimeId: "antigravity-cli:antigravity-cli",
          kind: "output_contract",
          failureCount: 1,
          until: "2026-09-01T09:00:00.000Z",
          updatedAt: backoffUpdatedAt,
          reason: "successful empty output",
        },
      }
      : {}),
  };
}

describe("agy-canary command", () => {
  it("uses window-local observations and actual dismissal time", () => {
    const incidents = agyCanaryProviderIncidents(
      [{
        id: "dlq-provider",
        status: "dismissed",
        failure: {
          lastErrorClass: "provider",
          retryCount: 5,
          firstFailedAt: "2026-09-01T01:00:00.000Z",
          lastFailedAt: "2026-09-01T08:00:00.000Z",
          observationTimes: [
            "2026-09-01T01:00:00.000Z",
            "2026-09-01T02:00:00.000Z",
            "2026-09-01T03:00:00.000Z",
            "2026-09-01T04:00:00.000Z",
            "2026-09-01T08:00:00.000Z",
          ],
          backoffUntil: "2026-09-01T12:00:00.000Z",
        },
        dismissedAt: "2026-09-01T09:00:00.000Z",
      }] as unknown as Parameters<typeof agyCanaryProviderIncidents>[0],
      workflowStatus(false) as unknown as Parameters<
        typeof agyCanaryProviderIncidents
      >[1],
      "2026-09-01T06:00:00.000Z",
    );

    expect(incidents).toMatchObject([{
      observations: 1,
      firstObservedAt: "2026-09-01T01:00:00.000Z",
      resetAt: "2026-09-01T09:00:00.000Z",
    }]);
    expect(agyCanaryProviderBackoffDurationMs(
      incidents,
      "2026-09-01T06:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
    )).toBe(3 * 60 * 60 * 1000);
  });

  it("recognizes executed code-step agent contracts without an agent-typed step", () => {
    const run = {
      id: "run-code-judge",
      workflow: "reviewer",
      steps: [{
        id: "judge",
        type: "code",
        status: "success",
        durationMs: 1,
      }],
    } as unknown as WorkflowRunDetail;
    const definition = {
      name: "reviewer",
      steps: [{
        id: "judge",
        type: "code",
        resolveAgentContract: () => ({
          harness: "antigravity-cli",
          model: "gemini-2.5-pro",
          effort: "high",
          autonomyMode: "autonomous",
        }),
        run: () => "reviewed",
      }],
    } as unknown as WorkflowDefinition;

    expect(observedAgyAgentRuns(
      [run],
      new Map([[definition.name, definition]]),
    )).toEqual([run]);
  });

  it("carries active runs across windows, grounds review, and suppresses review during an output incident", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const root = mkdtempSync(join(tmpdir(), "kota-agy-canary-"));
    roots.push(root);
    const runId = "run-1";
    const runDir = join(root, ".kota", "runs", runId);
    mkdirSync(join(runDir, "steps"), { recursive: true });
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify({ id: runId }));
    writeFileSync(
      join(runDir, "steps", "build.input.md"),
      "# System Prompt Appendix\n\n(redacted provider payload)\n",
    );
    writeFileSync(join(root, "agent.md"), "Review the canary run.\n");
    writeFileSync(join(root, "AGENTS.md"), "Follow the task and inspect examples.\n");

    let incident = false;
    let incidentUpdatedAt = "2026-09-01T02:30:00.000Z";
    let failReviewWithIncident = false;
    const observedRunStartedAt = "2026-08-31T23:00:00.000Z";
    let observedRunStatus = "waiting";
    let observedRunCompletedAt: string | undefined;
    const pause = vi.fn();
    const pauseAgentForQuality = vi.fn(async () => ({
      ok: true as const,
      paused: true as const,
      already: false,
    }));
    const create = vi.fn(async () => ({
      ok: true as const,
      id: "task-investigate-agy-canary-finding-review-timeout",
      path: "data/tasks/task-investigate-agy-canary-finding-review-timeout.md",
    }));
    const runOneShot = vi.fn(async (prompt: string) => {
      if (failReviewWithIncident) {
        incident = true;
        incidentUpdatedAt = new Date().toISOString();
        throw new Error("Agent dispatch is backed off (output_contract)");
      }
      const allowed = JSON.parse(
        prompt.match(/Allowed citations: (\[[^\n]+\])/)?.[1] ?? "[]",
      ) as Array<{ runId: string; evidenceRefs: string[] }>;
      return {
        ok: true as const,
        text: JSON.stringify({
          runs: [{
            runId,
            useful: true,
            instructionAdherent: true,
            cleanupHealthy: true,
            rushedWork: false,
            shallowVerification: false,
            unrelatedChangedPaths: [],
            generatedDebrisPaths: [],
            evidenceRefs: allowed[0]!.evidenceRefs,
          }],
          minorFindings: [{
            fingerprint: "review-timeout",
            title: "Review latency was elevated",
            description:
              "The review exceeded its expected latency and needs a focused timeout investigation.",
            evidenceRef: allowed[0]!.evidenceRefs[0],
          }],
        }),
      };
    });
    const updateBody = vi.fn(async () => ({
      ok: true as const,
      id: "task-investigate-agy-canary-finding-review-timeout",
      state: "open" as const,
      content: "updated",
    }));
    const ctx = {
      cwd: root,
      config: { defaultAgentHarness: "thin" },
      getContributedWorkflows: () => [{
        name: "builder",
        enabled: true,
        definitionPath: "builder.test.ts",
        moduleRoot: root,
        repository: "none",
        defaultAutonomyMode: "autonomous",
        triggers: [{ event: "manual", cooldownMs: 0 }],
        steps: [{
          id: "build",
          type: "agent",
          agentName: "canary-reviewer",
        }],
      }],
      resolveAgentDef: () => ({
        name: "canary-reviewer",
        role: "Review the canary run.",
        promptPath: "agent.md",
        model: "test-model",
        effort: "low" as const,
        writeScope: [],
      }),
      resolveSkillsPrompt: () => "Use the representative examples before deciding.",
      client: {
        workflow: {
          status: vi.fn(async () =>
            workflowStatus(incident, incidentUpdatedAt)
          ),
          listRuns: vi.fn(async () => ({
            runs: [{
                id: runId,
                workflow: "builder",
                status: observedRunStatus,
                triggerEvent: "autonomy.queue.available",
                triggerSchemaRef: null,
                startedAt: observedRunStartedAt,
              }],
          })),
          getRun: vi.fn(async () => ({
            found: true as const,
            run: {
              id: runId,
              workflow: "builder",
              status: observedRunStatus,
              triggerEvent: "autonomy.queue.available",
              triggerSchemaRef: null,
              startedAt: observedRunStartedAt,
              ...(observedRunCompletedAt === undefined
                ? {}
                : { completedAt: observedRunCompletedAt }),
              triggerPayload: {
                taskId: "task-work",
                taskPath: "data/tasks/task-work.md",
              },
              steps: [{
                id: "build",
                type: "agent",
                status: observedRunStatus === "running"
                  ? "success"
                  : observedRunStatus,
                durationMs: 1,
              }],
            },
          })),
          listDeadLetters: vi.fn(async () => incident
            ? {
              counts: { open: 1, dismissed: 0, redriven: 0 },
              items: [{
                id: "dlq-output-contract",
                type: "workflow-dispatch",
                status: "open",
                scopeId: "scope-1",
                owningModule: "autonomy",
                sourceEventIds: [],
                affectedWorkflowNames: ["builder"],
                failure: {
                  reason: "successful empty output",
                  retryCount: 1,
                  lastErrorClass: "output_contract",
                  firstFailedAt: "2026-09-01T01:00:00.000Z",
                  lastFailedAt: "2026-09-01T02:30:00.000Z",
                  observationTimes: ["2026-09-01T02:30:00.000Z"],
                },
                source: {
                  kind: "workflow-dispatch",
                  workflowName: "builder",
                  triggerEvent: "autonomy.queue.available",
                  triggerSchemaRef: null,
                  failedRunId: runId,
                },
                redrive: {
                  kind: "none",
                  reason: "operator retry required",
                },
                redactedProjection: {},
                createdAt: "2026-09-01T01:00:00.000Z",
                updatedAt: "2026-09-01T02:30:00.000Z",
                redriveAttempts: [],
                retention: { kind: "retain" },
              }],
            }
            : {
              counts: { open: 0, dismissed: 0, redriven: 0 },
              items: [],
            }),
          pause,
          pauseAgentForQuality,
        },
        sessions: { runOneShot },
        tasks: {
          list: vi.fn(async () => ({
            tasks: [{
              id: "task-work",
              priority: "p1",
              title: "Work",
              state: "open",
              waitingOnTasks: [],
            }],
          })),
          show: vi.fn(async () => ({
            found: true as const,
            state: "open" as const,
            content:
              "---\nstatus: open\npriority: p1\n---\n\n# Work\n\nFollow the documented example.\n",
          })),
          create,
          updateBody,
        },
      },
    } as unknown as ModuleContext;

    await buildAgyCanaryCommand(ctx).parseAsync([
      "--run-id",
      "canary-1",
      "--start",
    ], { from: "user" });
    await buildAgyCanaryCommand(ctx).parseAsync([
      "--run-id",
      "canary-incident",
      "--start",
    ], { from: "user" });
    observedRunStatus = "running";
    vi.setSystemTime(new Date("2026-09-01T03:00:00.000Z"));
    await buildAgyCanaryCommand(ctx).parseAsync([
      "--run-id",
      "canary-1",
      "--phase",
      "three-hour",
    ], { from: "user" });

    expect(runOneShot).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const healthyArtifact = readCanaryArtifact(
      root,
      "canary-1",
      "three-hour",
    );
    expect(healthyArtifact.metrics).toMatchObject({
      agentRuns: 0,
      activeAgentRuns: 1,
    });
    expect(healthyArtifact.qualityReview).toMatchObject({
      status: "suppressed",
    });

    observedRunStatus = "success";
    observedRunCompletedAt = "2026-09-01T04:00:00.000Z";
    vi.setSystemTime(new Date("2026-09-01T09:00:00.000Z"));
    await buildAgyCanaryCommand(ctx).parseAsync([
      "--run-id",
      "canary-1",
      "--phase",
      "six-hour",
    ], { from: "user" });
    const sixHourArtifact = readCanaryArtifact(root, "canary-1", "six-hour");
    expect(sixHourArtifact.windowDurationMs).toBe(6 * 60 * 60 * 1000);
    expect(sixHourArtifact.metrics).toMatchObject({
      agentRuns: 1,
      activeAgentRuns: 0,
      usefulCompletions: 1,
    });
    expect(sixHourArtifact.qualityReview).toMatchObject({
      status: "completed",
      runs: [{ runId }],
    });
    expect(runOneShot).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(updateBody).toHaveBeenCalledWith(
      "task-investigate-agy-canary-finding-review-timeout",
      expect.stringContaining("Canary evidence"),
    );
    const contextPath = join(
      root,
      ".kota/runs/canary-1/agy-continuous-canary/six-hour",
      readdirSync(join(
        root,
        ".kota/runs/canary-1/agy-continuous-canary/six-hour",
      ))[0]!,
      `${runId}.quality-context.json`,
    );
    const qualityContext = JSON.parse(
      readFileSync(contextPath, "utf8"),
    ) as Record<string, unknown>;
    expect(qualityContext).toMatchObject({
      task: {
        taskId: "task-work",
        content: expect.stringContaining("documented example"),
      },
      steps: [{
        canonicalInputRef: `artifact:.kota/runs/${runId}/steps/build.input.md`,
        systemPrompt: expect.stringContaining(
          "Follow the task and inspect examples",
        ),
      }],
    });
    expect(readdirSync(join(
      root,
      ".kota/runs/canary-1/agy-continuous-canary/three-hour",
    ))).toHaveLength(1);

    incident = true;
    await buildAgyCanaryCommand(ctx).parseAsync([
      "--run-id",
      "canary-incident",
      "--phase",
      "three-hour",
    ], { from: "user" });

    expect(pause).not.toHaveBeenCalled();
    expect(pauseAgentForQuality).toHaveBeenCalledWith(
      "AGY canary three-hour: active-output-contract-incident",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(runOneShot).toHaveBeenCalledTimes(1);
    const artifact = readCanaryArtifact(
      root,
      "canary-incident",
      "three-hour",
    );
    expect(artifact.metrics).toMatchObject({
      agentRuns: 0,
      activeAgentRuns: 0,
      pendingReviewRuns: 1,
      dispatchableTasks: 1,
      successfulEmptyResults: 1,
    });
    expect(artifact.qualityReview).toEqual({
      status: "suppressed",
      reason: "active-output_contract-incident",
    });
    expect(artifact.control).toMatchObject({
      action: "workflow.agent.quality-pause",
    });

    incident = false;
    failReviewWithIncident = true;
    vi.setSystemTime(new Date("2026-09-01T15:00:00.000Z"));
    await buildAgyCanaryCommand(ctx).parseAsync([
      "--run-id",
      "canary-incident",
      "--phase",
      "six-hour",
    ], { from: "user" });

    const recoveredArtifact = readCanaryArtifact(
      root,
      "canary-incident",
      "six-hour",
    );
    expect(recoveredArtifact.metrics).toMatchObject({
      agentRuns: 1,
      activeAgentRuns: 0,
      pendingReviewRuns: 1,
      usefulCompletions: 0,
      instructionChecks: 0,
      successfulEmptyResults: 1,
    });
    expect(recoveredArtifact.qualityReview).toEqual({
      status: "suppressed",
      reason: "active-output_contract-incident",
    });
    expect(runOneShot).toHaveBeenCalledTimes(2);
    expect(runOneShot).toHaveBeenLastCalledWith(
      expect.any(String),
      { autonomyMode: "passive", agentBackoff: "fleet" },
    );
    const checkpoint = JSON.parse(readFileSync(join(
      root,
      ".kota/runs/canary-incident/agy-continuous-canary/checkpoint.json",
    ), "utf8")) as { carriedRunIds: string[] };
    expect(checkpoint.carriedRunIds).toEqual([runId]);
  });
});
