import { describe, expect, it } from "vitest";
import { decodeGardenerDecision } from "./decision.js";

describe("gardener decision boundary", () => {
  const noAction = { action: "no-action", rationale: "The exported handler is dynamically registered.", evidenceRefs: ["src/modules/a/index.ts"], existingTaskId: null, proposal: null };
  it("rejects fabricated verification and empty or inconsistent decisions", () => {
    expect(decodeGardenerDecision(noAction).action).toBe("no-action");
    expect(() => decodeGardenerDecision({ ...noAction, score: 100, protectedInvariantsPreserved: true })).toThrow();
    expect(() => decodeGardenerDecision({ ...noAction, action: "propose" })).toThrow();
    expect(() => decodeGardenerDecision({ ...noAction, action: "covered" })).toThrow();
    expect(() => decodeGardenerDecision({ ...noAction, evidenceRefs: [] })).toThrow();
  });
});
