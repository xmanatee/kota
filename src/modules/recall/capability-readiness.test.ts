import { describe, expect, it } from "vitest";
import { createRecallReadinessSource } from "./capability-readiness.js";
import type { RecallProvider, RecallSource } from "./recall-types.js";

function stubProvider(sources: ReadonlyArray<RecallSource>): RecallProvider {
  return {
    register: () => {},
    unregister: () => {},
    contributors: () => sources,
    recall: async () => [],
  };
}

describe("createRecallReadinessSource", () => {
  it("reports ready when contributors are registered", async () => {
    const source = createRecallReadinessSource(stubProvider(["knowledge", "memory"]));
    const reports = await source.probe();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      id: "recall",
      status: "ready",
      meta: { contributorCount: 2 },
    });
  });

  it("reports unavailable with no_contributors when none registered", async () => {
    const source = createRecallReadinessSource(stubProvider([]));
    const reports = await source.probe();
    expect(reports[0]).toMatchObject({
      id: "recall",
      status: "unavailable",
      reason: "no_contributors",
    });
  });
});
