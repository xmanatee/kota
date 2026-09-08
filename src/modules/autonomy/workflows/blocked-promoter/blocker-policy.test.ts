import { describe, expect, it } from "vitest";
import { renderOwnerAskMarker } from "#modules/repo-tasks/blocked-precondition.js";
import { decideBlockedAction, freshBlockerActionAt } from "./blocker-policy.js";
import { type BlockedTaskRecord, pickOwnerAskCandidate } from "./promotion.js";

const nowMs = Date.parse("2026-09-07T12:00:00Z");
const record: BlockedTaskRecord = {
  id: "task-owner", path: "data/tasks/task-owner.md", body: "", dependsOn: [],
  updatedAt: "2026-08-01T00:00:00Z",
  precondition: { kind: "owner-decision", slot: "direction", question: "Choose direction", context: null, proposedAnswers: ["unblock"] },
};
const waiting = { satisfied: false, reason: "owner has not answered" };

describe("blocked task decisions", () => {
  it("keeps dependency-waiting and resolved tasks out of owner-question selection", () => {
    for (const observation of [
      { waitingOn: ["task-enabler"], evaluation: waiting },
      { waitingOn: [], evaluation: { satisfied: true, reason: "owner answered" } },
    ]) {
      const action = decideBlockedAction({ record, nowMs, ...observation });
      expect(pickOwnerAskCandidate([record], [action])).toBeNull();
    }
    const due = decideBlockedAction({ record, nowMs, waitingOn: [], evaluation: waiting });
    expect(pickOwnerAskCandidate([record], [due])).toMatchObject({ taskId: record.id, slot: "direction" });
  });

  it("projects satisfied capabilities as promotable and hard dependencies take precedence", () => {
    const capability: BlockedTaskRecord = { ...record, precondition: { kind: "capability-installed", probe: "storageState:.kota/auth.json" } };
    const evaluation = { satisfied: true, reason: "capability present" };
    expect(decideBlockedAction({ record: capability, nowMs, waitingOn: [], evaluation }))
      .toMatchObject({ kind: "auto-promotable", reason: evaluation.reason });
    expect(decideBlockedAction({ record: capability, nowMs, waitingOn: ["task-enabler"], evaluation }))
      .toMatchObject({ kind: "still-awaiting-dependency" });
  });

  it("uses one freshness boundary for owner requests and digest suppression", () => {
    const lastAskedAt = "2026-08-24T12:00:00Z";
    const marked = { ...record, body: renderOwnerAskMarker({ slot: "direction", lastAskedAt }) };
    expect(freshBlockerActionAt(marked.precondition, marked.body, nowMs - 1)).toBe(lastAskedAt);
    expect(decideBlockedAction({ record: marked, nowMs: nowMs - 1, waitingOn: [], evaluation: waiting }))
      .toMatchObject({ kind: "owner-ask-recent" });
    expect(freshBlockerActionAt(marked.precondition, marked.body, nowMs)).toBeNull();
    expect(decideBlockedAction({ record: marked, nowMs, waitingOn: [], evaluation: waiting }))
      .toMatchObject({ kind: "owner-ask-due" });
  });
});
