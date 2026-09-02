import { describe, expect, it } from "vitest";
import { resolveWorkflowRunPruneAuthority } from "./prune-authority.js";

describe("resolveWorkflowRunPruneAuthority", () => {
  it("combines the workflow-status authority projection with live handles", () => {
    const authority = resolveWorkflowRunPruneAuthority({
      liveRunIds: ["run-live-only"],
      protectedRunIds: [
        "run-queued",
        "run-running",
        "run-waiting",
        "run-integrating",
        "run-needs_attention",
      ],
      authorityCriticalRunIds: [
        "run-running",
        "run-waiting",
        "run-integrating",
        "run-needs_attention",
      ],
      operationallyActiveRunIds: [
        "run-running",
        "run-waiting",
        "run-integrating",
        "run-needs_attention",
      ],
      terminalRunIds: ["run-succeeded", "run-failed"],
    });

    expect([...authority.protectedRunIds].sort()).toEqual([
      "run-integrating",
      "run-live-only",
      "run-needs_attention",
      "run-queued",
      "run-running",
      "run-waiting",
    ]);
    expect([...authority.authorityCriticalRunIds].sort()).toEqual([
      "run-integrating",
      "run-needs_attention",
      "run-running",
      "run-waiting",
    ]);
    expect([...authority.operationallyActiveRunIds].sort()).toEqual([
      "run-integrating",
      "run-needs_attention",
      "run-running",
      "run-waiting",
    ]);
    expect([...authority.terminalRunIds].sort()).toEqual([
      "run-failed",
      "run-succeeded",
    ]);
  });

  it("refuses destructive pruning without canonical durable authority", () => {
    expect(() =>
      resolveWorkflowRunPruneAuthority({
        liveRunIds: [],
        protectedRunIds: undefined,
        authorityCriticalRunIds: undefined,
        operationallyActiveRunIds: undefined,
        terminalRunIds: undefined,
      })
    ).toThrow(/canonical durable run authority/);
  });
});
