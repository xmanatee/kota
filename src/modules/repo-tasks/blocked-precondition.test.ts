import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateBlockedPrecondition,
  parseBlockedPrecondition,
  promotionTargetState,
  readOwnerAskMarkers,
  renderOwnerAskMarker,
  renderOwnerResolvedMarker,
  upsertOwnerAskMarker,
} from "./blocked-precondition.js";

function bodyWith(section: string): string {
  return [
    "## Problem",
    "",
    "Body.",
    "",
    section,
    "",
  ].join("\n");
}

function fenced(...lines: string[]): string {
  return ["## Unblock Precondition", "", "```", ...lines, "```"].join("\n");
}

function inline(...lines: string[]): string {
  return ["## Unblock Precondition", "", ...lines].join("\n");
}

describe("parseBlockedPrecondition", () => {
  it("rejects bodies that lack the section", () => {
    const result = parseBlockedPrecondition("## Problem\n\nNo precondition.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing-section");
  });

  it("rejects an empty section", () => {
    const result = parseBlockedPrecondition(bodyWith("## Unblock Precondition\n\n"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/);
  });

  it("rejects unknown kinds", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: budget-approved", "amount: 1000")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown precondition kind/);
  });

  it("parses task-done", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: task-done", "ref: task-foo-bar")),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.precondition).toEqual({
        kind: "task-done",
        ref: "task-foo-bar",
      });
    }
  });

  it("rejects task-done with a non-task-id ref", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: task-done", "ref: not-a-task-id")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/task-done 'ref' must match/);
  });

  it("parses capability-installed playwright probe", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: capability-installed", "probe: playwright")),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.precondition).toEqual({
        kind: "capability-installed",
        probe: "playwright",
      });
    }
  });

  it("parses capability-installed storageState probe", () => {
    const result = parseBlockedPrecondition(
      bodyWith(
        fenced("kind: capability-installed", "probe: storageState:.kota/auth.json"),
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.precondition).toEqual({
        kind: "capability-installed",
        probe: "storageState:.kota/auth.json",
      });
    }
  });

  it("rejects unknown probes", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: capability-installed", "probe: ffmpeg")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/probe' must be/);
  });

  it("parses owner-decision with a slot, question, and answers", () => {
    const result = parseBlockedPrecondition(
      bodyWith(
        fenced(
          "kind: owner-decision",
          "slot: pick-a-variant",
          "question: Which variant?",
          "context: Variants A, B, hybrid sketched in body.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
        ),
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.precondition).toEqual({
        kind: "owner-decision",
        slot: "pick-a-variant",
        question: "Which variant?",
        context: "Variants A, B, hybrid sketched in body.",
        proposedAnswers: ["variant-a", "variant-b", "hybrid", "unblock"],
      });
    }
  });

  it("rejects owner-decision missing question", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: owner-decision", "slot: needs-pick")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires 'question'/);
  });

  it("rejects owner-decision whose question does not end with '?'", () => {
    const result = parseBlockedPrecondition(
      bodyWith(
        fenced(
          "kind: owner-decision",
          "slot: needs-pick",
          "question: Pick a variant. See the body for trade-offs.",
        ),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must end with '\?'/);
  });

  it("parses operator-capture with path and description", () => {
    const result = parseBlockedPrecondition(
      bodyWith(
        fenced(
          "kind: operator-capture",
          "path: .kota/runs/peer-cli-*",
          "description: peer-CLI side-by-side captures",
        ),
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.precondition).toEqual({
        kind: "operator-capture",
        path: ".kota/runs/peer-cli-*",
        description: "peer-CLI side-by-side captures",
      });
    }
  });

  it("rejects operator-capture missing description", () => {
    const result = parseBlockedPrecondition(
      bodyWith(fenced("kind: operator-capture", "path: .kota/runs/foo")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires 'description'/);
  });

  it("accepts a section without a fenced code block", () => {
    const result = parseBlockedPrecondition(
      bodyWith(inline("kind: task-done", "ref: task-something")),
    );
    expect(result.ok).toBe(true);
  });
});

function makeBlockedTaskTree(): { projectDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "blocked-precondition-"));
  for (const state of ["done", "blocked", "ready", "backlog"]) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  return { projectDir };
}

describe("evaluateBlockedPrecondition", () => {
  it("task-done is satisfied when the referent file exists in done/", () => {
    const { projectDir } = makeBlockedTaskTree();
    writeFileSync(
      join(projectDir, "data", "tasks", "done", "task-enabler.md"),
      "---\nid: task-enabler\n---\n",
    );
    const result = evaluateBlockedPrecondition(
      { kind: "task-done", ref: "task-enabler" },
      { projectDir, taskBody: "" },
    );
    expect(result.satisfied).toBe(true);
  });

  it("task-done is not satisfied when the referent file is missing", () => {
    const { projectDir } = makeBlockedTaskTree();
    const result = evaluateBlockedPrecondition(
      { kind: "task-done", ref: "task-enabler" },
      { projectDir, taskBody: "" },
    );
    expect(result.satisfied).toBe(false);
  });

  it("operator-capture matches a glob path", () => {
    const { projectDir } = makeBlockedTaskTree();
    mkdirSync(join(projectDir, ".kota", "runs", "harness-parity-2026-04-25"), {
      recursive: true,
    });
    const matched = evaluateBlockedPrecondition(
      {
        kind: "operator-capture",
        path: ".kota/runs/harness-parity-*",
        description: "x",
      },
      { projectDir, taskBody: "" },
    );
    expect(matched.satisfied).toBe(true);

    const missing = evaluateBlockedPrecondition(
      {
        kind: "operator-capture",
        path: ".kota/runs/peer-cli-*",
        description: "x",
      },
      { projectDir, taskBody: "" },
    );
    expect(missing.satisfied).toBe(false);
  });

  it("owner-decision is satisfied only when a matching resolved marker exists", () => {
    const { projectDir } = makeBlockedTaskTree();
    const without = evaluateBlockedPrecondition(
      {
        kind: "owner-decision",
        slot: "pick-variant",
        question: "?",
        context: null,
        proposedAnswers: [],
      },
      { projectDir, taskBody: "no marker" },
    );
    expect(without.satisfied).toBe(false);

    const marker = renderOwnerResolvedMarker({
      slot: "pick-variant",
      resolvedAt: "2026-04-25T00:00:00.000Z",
    });
    const withMarker = evaluateBlockedPrecondition(
      {
        kind: "owner-decision",
        slot: "pick-variant",
        question: "?",
        context: null,
        proposedAnswers: [],
      },
      { projectDir, taskBody: marker },
    );
    expect(withMarker.satisfied).toBe(true);
  });

  it("capability-installed for storageState reads the file path", () => {
    const { projectDir } = makeBlockedTaskTree();
    const present = join(projectDir, "auth.json");
    writeFileSync(present, "{}");

    const matched = evaluateBlockedPrecondition(
      { kind: "capability-installed", probe: "storageState:auth.json" },
      { projectDir, taskBody: "" },
    );
    expect(matched.satisfied).toBe(true);

    const missing = evaluateBlockedPrecondition(
      { kind: "capability-installed", probe: "storageState:nope.json" },
      { projectDir, taskBody: "" },
    );
    expect(missing.satisfied).toBe(false);
  });
});

describe("promotionTargetState", () => {
  it("sends p0 and p1 to ready and everything else to backlog", () => {
    expect(promotionTargetState("p0")).toBe("ready");
    expect(promotionTargetState("p1")).toBe("ready");
    expect(promotionTargetState("p2")).toBe("backlog");
    expect(promotionTargetState("p3")).toBe("backlog");
    expect(promotionTargetState("")).toBe("backlog");
  });
});

describe("ownerAskMarker round-trip", () => {
  it("parses and round-trips an inserted marker", () => {
    const body = "Body text\n\n";
    const updated = upsertOwnerAskMarker(body, {
      slot: "pick-variant",
      lastAskedAt: "2026-04-25T00:00:00.000Z",
    });
    expect(updated).toContain(
      renderOwnerAskMarker({
        slot: "pick-variant",
        lastAskedAt: "2026-04-25T00:00:00.000Z",
      }),
    );
    const markers = readOwnerAskMarkers(updated);
    expect(markers).toEqual([
      { slot: "pick-variant", lastAskedAt: "2026-04-25T00:00:00.000Z" },
    ]);
  });

  it("replaces an existing marker for the same slot", () => {
    const initial = upsertOwnerAskMarker("Body\n", {
      slot: "pick-variant",
      lastAskedAt: "2026-04-10T00:00:00.000Z",
    });
    const refreshed = upsertOwnerAskMarker(initial, {
      slot: "pick-variant",
      lastAskedAt: "2026-04-25T00:00:00.000Z",
    });
    const markers = readOwnerAskMarkers(refreshed);
    expect(markers).toEqual([
      { slot: "pick-variant", lastAskedAt: "2026-04-25T00:00:00.000Z" },
    ]);
  });
});
