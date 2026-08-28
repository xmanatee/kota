import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import {
  answerOwnerDecisionLocal,
  cancelOwnerDecisionLocal,
  listOwnerDecisionsLocal,
  showOwnerDecisionLocal,
} from "./operations.js";

describe("owner-decisions operations", () => {
  let dir: string;
  let decisionStore: OwnerDecisionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "owner-decisions-operations-"));
    decisionStore = new OwnerDecisionStore(join(dir, "decisions"), "scope-a");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers a pending decision and projects the client outcome", () => {
    const decision = decisionStore.create({
      request: {
        kind: "single-choice",
        prompt: "Book the 7pm slot?",
        options: [
          { id: "yes", label: "Book it" },
          { id: "no", label: "Do not book" },
        ],
      },
      requester: { kind: "manual", source: "test" },
      evidence: [{ summary: "Channel opportunity confirmation." }],
    });

    const answered = answerOwnerDecisionLocal(
      decisionStore,
      decision.id,
      { kind: "single-choice", optionId: "yes" },
      "test",
    );

    expect(answered?.status).toBe("answered");
    expect(answered?.selectedValue).toEqual({ kind: "single-choice", optionId: "yes" });

    const listed = listOwnerDecisionsLocal(decisionStore, "answered");
    expect(listed.decisions).toHaveLength(1);
    expect(listed.decisions[0].id).toBe(decision.id);
  });

  it("cancels a pending decision with reason and projects the client outcome", () => {
    const decision = decisionStore.create({
      request: {
        kind: "single-choice",
        prompt: "Proceed with deployment?",
        options: [
          { id: "yes", label: "Deploy" },
          { id: "no", label: "Cancel" },
        ],
      },
      requester: { kind: "manual", source: "test" },
      evidence: [{ summary: "Deployment gate." }],
    });

    const canceled = cancelOwnerDecisionLocal(
      decisionStore,
      decision.id,
      "operator dismissed",
      "test",
    );

    expect(canceled?.status).toBe("canceled");
    expect(canceled?.canceledReason).toBe("operator dismissed");
  });

  it("redacts sensitive form fields in answered decisions", () => {
    const decision = decisionStore.create({
      request: {
        kind: "form",
        prompt: "Confirm provider reference.",
        fields: [
          { id: "apiToken", label: "API token", type: "text", required: true },
          { id: "destination", label: "Destination", type: "text", required: true },
        ],
      },
      requester: { kind: "manual", source: "test" },
      evidence: [{ summary: "Owner decision with credentials." }],
    });

    const answered = answerOwnerDecisionLocal(
      decisionStore,
      decision.id,
      { kind: "form", fields: { apiToken: "secret-value", destination: "calendar" } },
      "test",
    );

    expect(answered?.selectedValue).toEqual({
      kind: "form",
      fields: { apiToken: "[redacted]", destination: "calendar" },
    });
  });

  it("does not project files outside the owner-decision store for traversal ids", () => {
    writeFileSync(join(dir, "secrets.json"), JSON.stringify({ token: "raw-secret" }));

    expect(showOwnerDecisionLocal(decisionStore, "../secrets")).toBeNull();
  });
});
