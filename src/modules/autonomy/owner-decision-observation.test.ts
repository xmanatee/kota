import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { observeOwnerDecisions } from "./owner-decision-observation.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("observes owner lifecycle changes through the scoped repository and rejects cross-scope records", () => {
  const root = mkdtempSync(join(tmpdir(), "autonomy-owner-observation-"));
  roots.push(root);
  expect(observeOwnerDecisions(root, "scope-a")).toEqual([]);
  const store = new OwnerDecisionStore(join(root, "owner-decisions"), "scope-a");
  const record = store.create({
    request: { kind: "single-choice", prompt: "Choose direction", options: [{ id: "a", label: "Proceed" }] },
    requester: { kind: "workflow", workflowName: "builder", runId: "observation", stepId: "ask", taskId: null },
    evidence: [],
  });
  store.answer(record.id, { kind: "single-choice", optionId: "a" }, "operator");
  expect(observeOwnerDecisions(root, "scope-a")).toEqual([store.get(record.id)]);
  expect(() => observeOwnerDecisions(root, "scope-b")).toThrow(/belongs to scope/);
});
