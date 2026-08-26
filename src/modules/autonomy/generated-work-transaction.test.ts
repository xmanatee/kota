import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { GeneratedWorkProposal } from "./generated-work-proposal.js";
import {
  finalizeGeneratedWorkOwnerEffects,
  stageGeneratedWorkProposal,
} from "./generated-work-transaction.js";

function questionProposal(): GeneratedWorkProposal {
  return {
    kind: "owner-question",
    proposalKey: "test:transactional-owner-question",
    context: "A decision is needed.",
    question: "Proceed?",
    reason: "The repository cannot decide this policy.",
    proposedAnswers: ["yes", "no"],
    provenance: {
      source: "transaction-test",
      runId: "run-1",
      evidenceRefs: ["evidence-1"],
    },
    origin: {
      kind: "workflow",
      workflowName: "transaction-test",
      runId: "run-1",
      stepId: "apply",
      taskId: null,
    },
  };
}

describe("generated-work transaction", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function workspaceRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "generated-work-transaction-"));
    scopeRoots.push(dir);
    return dir;
  }

  it("does not enqueue an owner question while staging repository work", () => {
    const dir = workspaceRoot();
    const proposal = questionProposal();

    const staged = stageGeneratedWorkProposal({ workspaceRoot: dir, proposal });

    expect(staged.actions).toEqual([{ kind: "owner-question-pending" }]);
    expect(existsSync(join(dir, ".kota", "owner-questions"))).toBe(false);

    const queue = new OwnerQuestionQueue(join(dir, ".kota", "owner-questions"));
    const finalized = finalizeGeneratedWorkOwnerEffects({
      workspaceRoot: dir,
      ownerQuestionQueue: queue,
      proposal,
    });
    expect(finalized.ownerQuestionId).toBeTruthy();
    expect(queue.list("pending")).toHaveLength(1);
  });

  it("does not dismiss an existing question before publication", () => {
    const dir = workspaceRoot();
    const proposal = questionProposal();
    const queue = new OwnerQuestionQueue(join(dir, ".kota", "owner-questions"));
    finalizeGeneratedWorkOwnerEffects({
      workspaceRoot: dir,
      ownerQuestionQueue: queue,
      proposal,
    });
    const resolution: GeneratedWorkProposal = {
      kind: "none",
      proposalKey: proposal.proposalKey,
      reason: "The decision was resolved by integrated repository evidence.",
      source: "transaction-test",
    };

    const staged = stageGeneratedWorkProposal({
      workspaceRoot: dir,
      proposal: resolution,
    });

    expect(staged.actions).toEqual([
      { kind: "owner-question-dismissal-pending" },
    ]);
    expect(queue.list("pending")).toHaveLength(1);
    finalizeGeneratedWorkOwnerEffects({
      workspaceRoot: dir,
      ownerQuestionQueue: queue,
      proposal: resolution,
    });
    expect(queue.list("pending")).toHaveLength(0);
    expect(queue.list("dismissed")).toHaveLength(1);
  });
});
