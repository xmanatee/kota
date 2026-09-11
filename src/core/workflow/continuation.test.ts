import { describe, expect, test } from "vitest";
import {
  continuationBoundaries,
  continuationPacketNeedsJudgment,
  createContinuationPacket,
  type WorkflowContinuationContext,
  type WorkflowContinuationRecord,
  type WorkflowContinuationRepairEvidence,
} from "./continuation.js";

const context: WorkflowContinuationContext = {
  taskContract: "# Preserve difficult work",
  current: { id: "task-current", priority: 1, priorityLabel: "p1" },
  queue: { revision: "queue-1", available: [] },
};

function evidence(
  attempt: number,
  failureIds: readonly string[],
  workspaceFingerprint: string,
  changedPaths: readonly string[] = ["src/current.ts"],
  source: "active" | "repair" = "repair",
): WorkflowContinuationRepairEvidence {
  return {
    attempt,
    source,
    verificationResults: failureIds.map((id) => ({
      id,
      passed: false,
      output: `${id} failed on attempt ${attempt}`,
    })),
    workspaceFingerprint,
    changedPaths,
  };
}

describe("workflow continuation boundaries", () => {
  test("leaves a fresh productive repair uninterrupted", () => {
    expect(
      continuationBoundaries({
        context,
        initialWorkspace: evidence(0, ["critic"], "initial"),
        trajectory: [evidence(1, ["critic"], "progress-1")],
        currentWorkspace: {
          fingerprint: "progress-1",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: ["critic"],
      }),
    ).toEqual([]);
  });

  test("lets a changing and strictly converging trajectory continue", () => {
    expect(
      continuationBoundaries({
        context,
        initialWorkspace: evidence(0, ["types", "owner", "critic"], "initial"),
        trajectory: [
          evidence(1, ["owner", "critic"], "progress-1"),
          evidence(2, ["critic"], "progress-2"),
        ],
        currentWorkspace: {
          fingerprint: "progress-2",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: ["critic"],
      }),
    ).toEqual([]);
  });

  test("finds active churn after repeated same-scope revisions without fresh verification", () => {
    expect(
      continuationBoundaries({
        context,
        initialWorkspace: evidence(0, [], "initial", [], "active"),
        trajectory: [
          evidence(1, [], "active-1", ["src/current.ts"], "active"),
          evidence(2, [], "active-2", ["src/current.ts"], "active"),
          evidence(3, [], "active-3", ["src/current.ts"], "active"),
        ],
        currentWorkspace: {
          fingerprint: "active-3",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: [],
      }),
    ).toEqual(["active-workspace-churn", "unresolved-acceptance"]);
  });

  test("retains verification outputs and finds repeated active failures", () => {
    const repeatedFailure = {
      id: "pnpm test",
      passed: false,
      output: "3 tests failed",
    };
    const trajectory: WorkflowContinuationRepairEvidence[] = [
      {
        ...evidence(1, [], "active-1", ["src/current.ts"], "active"),
        verificationResults: [repeatedFailure],
      },
      {
        ...evidence(2, [], "active-2", ["src/current.ts"], "active"),
        verificationResults: [repeatedFailure],
      },
    ];
    const packet = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, [], "initial", [], "active"),
      trajectory,
      currentWorkspace: {
        fingerprint: "active-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [],
    });

    expect(packet?.boundaries).toEqual([
      "active-verification-churn",
      "unresolved-acceptance",
    ]);
    expect(packet?.verificationTrajectory[0]?.verificationResults[0]).toEqual({
      id: "pnpm test",
      passed: false,
      output: "3 tests failed",
    });
  });

  test("treats reduced failures from the same check as fresh progress", () => {
    const activeEvidence = (
      attempt: number,
      workspaceFingerprint: string,
      output: string,
    ): WorkflowContinuationRepairEvidence => ({
      ...evidence(
        attempt,
        [],
        workspaceFingerprint,
        ["src/current.ts"],
        "active",
      ),
      verificationResults: [{
        id: "pnpm test",
        passed: false,
        output,
      }],
    });
    expect(
      continuationBoundaries({
        context,
        initialWorkspace: evidence(0, [], "initial", [], "active"),
        trajectory: [
          activeEvidence(1, "active-1", "10 tests failed"),
          activeEvidence(2, "active-2", "2 tests failed"),
        ],
        currentWorkspace: {
          fingerprint: "active-2",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: [],
      }),
    ).toEqual([]);
  });

  test("leaves distinct fresh verification failures uninterrupted", () => {
    expect(
      continuationBoundaries({
        context,
        initialWorkspace: evidence(0, [], "initial", [], "active"),
        trajectory: [
          evidence(1, ["pnpm test"], "active-1", ["src/current.ts"], "active"),
          evidence(2, ["pnpm check"], "active-2", ["src/current.ts"], "active"),
        ],
        currentWorkspace: {
          fingerprint: "active-2",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: [],
      }),
    ).toEqual([]);
  });

  test("leaves shrinking active verification failures uninterrupted", () => {
    expect(
      continuationBoundaries({
        context,
        initialWorkspace: evidence(0, [], "initial", [], "active"),
        trajectory: [
          evidence(
            1,
            ["types", "owner", "critic"],
            "active-1",
            ["src/current.ts"],
            "active",
          ),
          evidence(
            2,
            ["owner", "critic"],
            "active-2",
            ["src/current.ts"],
            "active",
          ),
        ],
        currentWorkspace: {
          fingerprint: "active-2",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: [],
      }),
    ).toEqual([]);
  });

  test.each([
    {
      scenario: "a changing diff with the same unresolved gate",
      first: ["critic"],
      second: ["critic"],
    },
    {
      scenario: "a changed failure without acceptance convergence",
      first: ["types"],
      second: ["critic"],
    },
    {
      scenario: "an expanding repair with additional unresolved gates",
      first: ["owner"],
      second: ["owner", "critic"],
    },
  ])(
    "finds the first repeated non-converging boundary for $scenario",
    ({ first, second }) => {
      const boundaries = continuationBoundaries({
        context,
        initialWorkspace: evidence(0, first, "initial"),
        trajectory: [
          evidence(1, first, "progress-1"),
          evidence(2, second, "progress-2"),
        ],
        currentWorkspace: {
          fingerprint: "progress-2",
          changedPaths: ["src/current.ts"],
        },
        remainingFailureIds: second,
      });

      expect(boundaries).toEqual(["repeated-repair", "unresolved-acceptance"]);
    },
  );

  test("reuses a decision while volatile evidence changes at the same semantic boundary", () => {
    const trajectory = [
      evidence(1, ["critic"], "progress-1"),
      evidence(2, ["critic"], "progress-2"),
    ];
    const base = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory,
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    const changed = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [...trajectory, evidence(3, ["critic"], "progress-3")],
      currentWorkspace: {
        fingerprint: "progress-3",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+different work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(changed?.boundaryKey).toBe(base?.boundaryKey);
    expect(changed?.evidenceFingerprint).not.toBe(base?.evidenceFingerprint);
    if (base === null || changed === null) throw new Error("missing packet");
    const prior: WorkflowContinuationRecord = {
      stepId: "build",
      decidedAt: "2026-08-25T10:00:00.000Z",
      packet: base,
      decision: {
        decision: "continue",
        rationale: "The current repair is still productive.",
        nextAction: "Complete the next repair.",
      },
    };
    expect(continuationPacketNeedsJudgment([prior], "build", changed)).toBe(
      false,
    );
    expect(continuationPacketNeedsJudgment([prior], "build", base)).toBe(false);

    const repeated = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [...trajectory],
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(repeated?.evidenceFingerprint).toBe(base.evidenceFingerprint);
    if (repeated === null) throw new Error("missing repeated packet");
    expect(continuationPacketNeedsJudgment([prior], "build", repeated)).toBe(
      false,
    );

    const inFlight = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory,
      currentWorkspace: {
        fingerprint: "progress-in-flight",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+unfinished work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(inFlight?.evidenceFingerprint).not.toBe(base.evidenceFingerprint);
    if (inFlight === null) throw new Error("missing in-flight packet");
    expect(continuationPacketNeedsJudgment([prior], "build", inFlight)).toBe(
      false,
    );

    const changedVerificationOutput = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [...trajectory, evidence(3, ["critic"], "progress-2")],
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "wording changed only" }],
    });
    expect(changedVerificationOutput?.boundaryKey).toBe(base?.boundaryKey);
    expect(changedVerificationOutput?.evidenceFingerprint).not.toBe(
      base.evidenceFingerprint,
    );
    if (changedVerificationOutput === null) {
      throw new Error("missing changed verification packet");
    }
    expect(
      continuationPacketNeedsJudgment(
        [prior],
        "build",
        changedVerificationOutput,
      ),
    ).toBe(false);

    const expanded = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [...trajectory, evidence(3, ["critic"], "progress-3")],
      currentWorkspace: {
        fingerprint: "progress-3",
        changedPaths: [
          "src/current.ts",
          "src/expanded-a.ts",
          "src/expanded-b.ts",
          "src/expanded-c.ts",
        ],
        diffStat: "4 files changed",
        diff: "+expanded work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(expanded?.boundaries).toContain("material-scope-expansion");
    if (expanded === null) throw new Error("missing expanded packet");
    expect(continuationPacketNeedsJudgment([prior], "build", expanded)).toBe(
      true,
    );

    const oscillating = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [...trajectory, evidence(3, ["critic"], "progress-1")],
      currentWorkspace: {
        fingerprint: "progress-1",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work returned to an earlier shape",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(oscillating?.evidenceFingerprint).not.toBe(base.evidenceFingerprint);
    if (oscillating === null) throw new Error("missing oscillating packet");
    expect(continuationPacketNeedsJudgment([prior], "build", oscillating)).toBe(
      false,
    );

    const withP0 = createContinuationPacket({
      context: {
        ...context,
        queue: {
          revision: "queue-2",
          available: [{
            id: "task-p0",
            title: "Repair runtime safety",
            priority: 0,
            priorityLabel: "p0",
            resource: "task:task-p0",
          }],
        },
      },
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory,
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(withP0?.boundaries).toContain("higher-priority-work");
    expect(withP0?.boundaryKey).not.toBe(base?.boundaryKey);
    if (withP0 === null) throw new Error("missing priority packet");
    expect(continuationPacketNeedsJudgment([prior], "build", withP0)).toBe(
      true,
    );

    const revisedQueue = createContinuationPacket({
      context: {
        ...context,
        queue: { ...context.queue, revision: "queue-2" },
      },
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory,
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    expect(revisedQueue?.boundaryKey).toBe(base.boundaryKey);
    expect(revisedQueue?.evidenceFingerprint).not.toBe(
      base.evidenceFingerprint,
    );
    if (revisedQueue === null) throw new Error("missing revised queue packet");
    expect(continuationPacketNeedsJudgment([prior], "build", revisedQueue))
      .toBe(
        false,
      );

    const activeChanged = createContinuationPacket({
      context: {
        ...context,
        queue: withP0.queue,
      },
      initialWorkspace: evidence(0, [], "active-1"),
      trajectory: [],
      currentWorkspace: {
        fingerprint: "active-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+more active work",
      },
      remainingFailures: [],
    });
    if (activeChanged === null) throw new Error("missing active packet");
    const activePriorPacket = createContinuationPacket({
      context: {
        ...context,
        queue: withP0.queue,
      },
      initialWorkspace: evidence(0, [], "active-1"),
      trajectory: [],
      currentWorkspace: {
        fingerprint: "active-1",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+active work",
      },
      remainingFailures: [],
    });
    if (activePriorPacket === null) {
      throw new Error("missing prior active packet");
    }
    const activePrior: WorkflowContinuationRecord = {
      stepId: "build",
      decidedAt: "2026-08-25T10:01:00.000Z",
      packet: activePriorPacket,
      decision: {
        decision: "continue",
        rationale: "The active run is healthy and nearly complete.",
        nextAction: "Finish the current implementation.",
      },
    };
    expect(activeChanged.evidenceFingerprint).not.toBe(
      activePrior.packet.evidenceFingerprint,
    );
    expect(
      continuationPacketNeedsJudgment([activePrior], "build", activeChanged),
    ).toBe(false);
  });

  test("reopens a continued boundary when unresolved repair evidence doubles", () => {
    const baseTrajectory = [
      evidence(1, ["critic"], "progress-1"),
      evidence(2, ["critic"], "progress-2"),
    ];
    const base = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: baseTrajectory,
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    const worsened = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [
        ...baseTrajectory,
        evidence(3, ["critic"], "progress-3"),
        evidence(4, ["critic"], "progress-4"),
      ],
      currentWorkspace: {
        fingerprint: "progress-4",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+different unresolved work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    if (base === null || worsened === null) throw new Error("missing packet");
    const prior: WorkflowContinuationRecord = {
      stepId: "build",
      decidedAt: "2026-08-25T10:00:00.000Z",
      packet: base,
      decision: {
        decision: "continue",
        rationale: "The current repair is still productive.",
        nextAction: "Complete the next repair.",
      },
    };

    expect(worsened.boundaryKey).toBe(base.boundaryKey);
    expect(continuationPacketNeedsJudgment([prior], "build", worsened)).toBe(
      true,
    );

    const renewed: WorkflowContinuationRecord = {
      ...prior,
      decidedAt: "2026-08-25T10:05:00.000Z",
      packet: worsened,
    };
    const volatile = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [
        ...baseTrajectory,
        evidence(3, ["critic"], "progress-3"),
        evidence(4, ["critic"], "progress-4"),
        evidence(5, ["critic"], "progress-5"),
      ],
      currentWorkspace: {
        fingerprint: "progress-5",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+one more volatile revision",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    if (volatile === null) throw new Error("missing volatile packet");
    expect(
      continuationPacketNeedsJudgment(
        [prior, renewed],
        "build",
        volatile,
      ),
    ).toBe(false);
  });

  test("reopens a continued boundary when unresolved failures strictly expand", () => {
    const trajectory = [
      evidence(1, ["critic"], "progress-1"),
      evidence(2, ["critic"], "progress-2"),
    ];
    const base = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory,
      currentWorkspace: {
        fingerprint: "progress-2",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [{ id: "critic", output: "still open" }],
    });
    const worsened = createContinuationPacket({
      context,
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory: [...trajectory, evidence(3, ["critic", "safety"], "progress-3")],
      currentWorkspace: {
        fingerprint: "progress-3",
        changedPaths: ["src/current.ts"],
        diffStat: "1 file changed",
        diff: "+work",
      },
      remainingFailures: [
        { id: "critic", output: "still open" },
        { id: "safety", output: "new regression" },
      ],
    });
    if (base === null || worsened === null) throw new Error("missing packet");
    const prior: WorkflowContinuationRecord = {
      stepId: "build",
      decidedAt: "2026-08-25T10:00:00.000Z",
      packet: base,
      decision: {
        decision: "continue",
        rationale: "The current repair is viable.",
        nextAction: "Finish it.",
      },
    };

    expect(continuationPacketNeedsJudgment([prior], "build", worsened)).toBe(
      true,
    );
  });

  test("keeps long-run continuation packets bounded", () => {
    const large = "evidence".repeat(2_000);
    const longPath = "path".repeat(100);
    const trajectory = Array.from({ length: 100 }, (_, index) => ({
      ...evidence(
        index + 1,
        Array.from({ length: 20 }, (__, resultIndex) => `check-${resultIndex}`),
        `progress-${index + 1}`,
        Array.from(
          { length: 100 },
          (__, pathIndex) =>
            `src/trajectory-${index}-${pathIndex}-${longPath}.ts`,
        ),
      ),
      verificationResults: Array.from({ length: 20 }, (__, resultIndex) => ({
        id: `check-${resultIndex}`,
        passed: false,
        output: large,
      })),
    }));
    const packet = createContinuationPacket({
      context: {
        ...context,
        taskContract: large,
        queue: {
          revision: "large-queue",
          available: Array.from({ length: 100 }, (_, index) => ({
            id: `task-${index}`,
            title: large,
            priority: 0,
            priorityLabel: "p0",
            resource: `task:task-${index}`,
          })),
        },
      },
      initialWorkspace: evidence(0, ["critic"], "initial"),
      trajectory,
      currentWorkspace: {
        fingerprint: "progress-100",
        changedPaths: Array.from(
          { length: 100 },
          (_, index) => `src/current-${index}-${longPath}.ts`,
        ),
        diffStat: large,
        diff: large,
      },
      remainingFailures: Array.from({ length: 100 }, (_, index) => ({
        id: `failure-${index}`,
        output: large,
      })),
    });

    if (packet === null) throw new Error("missing bounded packet");
    expect(packet.verificationTrajectory.map((entry) => entry.attempt)).toEqual(
      [
        1,
        2,
        3,
        99,
        100,
      ],
    );
    expect(
      packet.verificationTrajectory.every(
        (entry) =>
          entry.verificationResults.length <= 3 &&
          entry.changedPaths.length <= 6,
      ),
    ).toBe(true);
    expect(packet.remainingFailures).toHaveLength(6);
    expect(packet.queue.available).toHaveLength(12);
    expect(packet.workspace.changedPaths).toHaveLength(20);
    expect(JSON.stringify(packet).length).toBeLessThan(75_000);
  });
});
