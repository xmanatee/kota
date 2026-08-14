import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import {
  checkWatchlistUpdatesCommitMessage,
  WATCHLIST_UPDATES_FILE,
} from "./watchlist-updates.js";
import explorerWorkflow from "./workflow.js";

describe("explorer watchlist update commit-message repair check", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "explorer-watchlist-run-"));
  });

  it("allows no-op runs without planned watchlist updates to omit a commit message", () => {
    expect(checkWatchlistUpdatesCommitMessage(runDir)).toBe(
      "OK: no watchlist updates — commit message not required",
    );
  });

  it("rejects planned watchlist updates without a commit message", () => {
    writeFileSync(
      join(runDir, WATCHLIST_UPDATES_FILE),
      JSON.stringify({
        updates: [{ url: "https://example.test/watch", accessible: false }],
      }),
    );

    expect(() => checkWatchlistUpdatesCommitMessage(runDir)).toThrow(
      /commit-message\.txt is required before apply-watchlist-updates/,
    );
  });

  it("accepts planned watchlist updates when the run has a commit message", () => {
    writeFileSync(
      join(runDir, WATCHLIST_UPDATES_FILE),
      JSON.stringify({
        updates: [{ url: "https://example.test/watch", accessible: false }],
      }),
    );
    writeFileSync(join(runDir, "commit-message.txt"), "Explorer: refresh watchlist");

    expect(checkWatchlistUpdatesCommitMessage(runDir)).toBe(
      "OK: commit-message.txt present for 1 watchlist update(s)",
    );
  });

  it("wires the check into the explore repair loop before commit", () => {
    const exploreStep = explorerWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "explore" && step.type === "agent",
    );
    if (!exploreStep || !exploreStep.repairLoop) throw new Error("explore step missing");

    const checkIds = exploreStep.repairLoop.checks.map((check) => check.id);
    expect(checkIds).toContain("watchlist-update-commit-message");
    expect(checkIds.indexOf("watchlist-update-commit-message")).toBeLessThan(
      checkIds.indexOf("commit-message-exists"),
    );
  });
});
