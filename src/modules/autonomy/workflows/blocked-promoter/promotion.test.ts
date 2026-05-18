import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readOperatorCaptureInstructedMarker,
  readOwnerAskMarkers,
  renderOperatorCaptureInstructedMarker,
  renderOwnerAskMarker,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  applyOperatorCaptureInstruction,
  type BlockedTaskRecord,
  type BlockerAction,
  classifyBlockedActions,
  extractRecommendedAnswer,
  listBlockedTasksWithPreconditions,
  listOperatorCaptureInstructCandidates,
  pickOwnerAskCandidate,
} from "./promotion.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "blocked-promoter-promotion-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function blockedTask(opts: {
  projectDir: string;
  id: string;
  preconditionLines: string[];
  daysAgo: number;
  priority?: string;
  dependsOn?: string[];
  bodySuffix?: string;
}): void {
  const updatedAt = new Date(Date.now() - opts.daysAgo * MS_PER_DAY).toISOString();
  const priority = opts.priority ?? "p2";
  const content = [
    "---",
    `id: ${opts.id}`,
    `title: ${opts.id}`,
    "status: blocked",
    `priority: ${priority}`,
    "area: autonomy",
    `summary: ${opts.id}`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
    ...(opts.dependsOn ? [`depends_on: [${opts.dependsOn.join(", ")}]`] : []),
    "---",
    "",
    "## Problem",
    "Body.",
    "",
    "## Unblock Precondition",
    "",
    "```",
    ...opts.preconditionLines,
    "```",
    "",
    opts.bodySuffix ?? "",
    "",
  ].join("\n");
  writeFileSync(
    join(opts.projectDir, "data", "tasks", "blocked", `${opts.id}.md`),
    content,
  );
}

describe("extractRecommendedAnswer", () => {
  it("returns null for empty or undefined input", () => {
    expect(extractRecommendedAnswer(null)).toBeNull();
    expect(extractRecommendedAnswer(undefined)).toBeNull();
    expect(extractRecommendedAnswer("")).toBeNull();
  });

  it("parses 'Recommended: <slug>' from a context paragraph", () => {
    expect(
      extractRecommendedAnswer("Some context. Recommended: variant-a. Rationale: …"),
    ).toBe("variant-a");
  });

  it("parses leading 'Recommended:' on its own", () => {
    expect(extractRecommendedAnswer("Recommended: foo_bar.")).toBe("foo_bar");
  });

  it("returns null when no Recommended line is present", () => {
    expect(extractRecommendedAnswer("Variants A, B, hybrid sketched in body.")).toBeNull();
  });
});

describe("pickOwnerAskCandidate surfaces recommendedAnswer", () => {
  it("includes recommendedAnswer when context names one", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-pick-variant",
      daysAgo: 5,
      preconditionLines: [
        "kind: owner-decision",
        "slot: pick-variant",
        "question: Which variant?",
        "context: Recommended: variant-a. Rationale: ctx.",
        "proposed_answers: variant-a, variant-b, hybrid, unblock",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidate = pickOwnerAskCandidate(records, Date.now());
    expect(candidate).not.toBeNull();
    expect(candidate?.recommendedAnswer).toBe("variant-a");
  });

  it("recommendedAnswer is null when context has no Recommended line", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-pick-variant-2",
      daysAgo: 5,
      preconditionLines: [
        "kind: owner-decision",
        "slot: pick-variant-2",
        "question: Which variant?",
        "context: Variants A, B sketched in body.",
        "proposed_answers: variant-a, variant-b, unblock",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidate = pickOwnerAskCandidate(records, Date.now());
    expect(candidate?.recommendedAnswer).toBeNull();
  });
});

describe("classifyBlockedActions", () => {
  it("classifies task-done blockers as auto-promotable when enabler is in done/", () => {
    const dir = makeProjectDir();
    writeFileSync(
      join(dir, "data", "tasks", "done", "task-enabler.md"),
      "---\nid: task-enabler\nstatus: done\n---\n# done\n",
    );
    blockedTask({
      projectDir: dir,
      id: "task-depends",
      daysAgo: 2,
      preconditionLines: ["kind: task-done", "ref: task-enabler"],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("auto-promotable");
    expect(actions[0].preconditionKind).toBe("task-done");
  });

  it("classifies task-done blockers as still-awaiting-task when enabler missing", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-depends-missing",
      daysAgo: 2,
      preconditionLines: ["kind: task-done", "ref: task-enabler-missing"],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("still-awaiting-task");
    if (actions[0].kind === "still-awaiting-task") {
      expect(actions[0].enablerRef).toBe("task-enabler-missing");
    }
  });

  it("classifies capability-installed as still-awaiting-capability when probe fails", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-cap",
      daysAgo: 2,
      preconditionLines: [
        "kind: capability-installed",
        "probe: storageState:.kota/auth.json",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("still-awaiting-capability");
  });

  it("classifies blocked tasks with unfinished hard dependencies before precondition action", () => {
    const dir = makeProjectDir();
    writeFileSync(
      join(dir, "data", "tasks", "backlog", "task-enabler.md"),
      "---\nid: task-enabler\nstatus: backlog\n---\n# backlog\n",
    );
    blockedTask({
      projectDir: dir,
      id: "task-owner-after-dependency",
      daysAgo: 20,
      dependsOn: ["task-enabler"],
      preconditionLines: [
        "kind: owner-decision",
        "slot: pick-variant",
        "question: Which variant?",
      ],
    });

    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());

    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("still-awaiting-dependency");
    if (actions[0].kind === "still-awaiting-dependency") {
      expect(actions[0].waitingOn).toEqual(["task-enabler"]);
    }
  });

  it("classifies a due owner-decision as owner-ask-due with recommendedAnswer", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-pick-variant",
      daysAgo: 20,
      preconditionLines: [
        "kind: owner-decision",
        "slot: pick-variant",
        "question: Which variant?",
        "context: Recommended: variant-a. Rationale: x.",
        "proposed_answers: variant-a, variant-b, unblock",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("owner-ask-due");
    if (actions[0].kind === "owner-ask-due") {
      expect(actions[0].recommendedAnswer).toBe("variant-a");
      expect(actions[0].slot).toBe("pick-variant");
      expect(actions[0].proposedAnswers).toContain("variant-a");
    }
  });

  it("classifies an owner-decision with fresh ask marker as owner-ask-recent", () => {
    const dir = makeProjectDir();
    const recentMarker = renderOwnerAskMarker({
      slot: "pick-variant",
      lastAskedAt: new Date(Date.now() - 1 * MS_PER_DAY).toISOString(),
    });
    blockedTask({
      projectDir: dir,
      id: "task-pick-variant-recent",
      daysAgo: 20,
      preconditionLines: [
        "kind: owner-decision",
        "slot: pick-variant",
        "question: Which variant?",
        "context: ctx.",
        "proposed_answers: variant-a, unblock",
      ],
      bodySuffix: recentMarker,
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("owner-ask-recent");
  });

  it("classifies operator-capture under threshold as operator-capture-fresh", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-fresh-capture",
      daysAgo: 5,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/foo",
        "description: x",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("operator-capture-fresh");
  });

  it("classifies aged operator-capture without marker as operator-capture-due", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-aged-capture",
      daysAgo: 30,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/peer-cli/*",
        "description: peer-CLI captures",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("operator-capture-due");
    if (actions[0].kind === "operator-capture-due") {
      expect(actions[0].capturePath).toBe(".kota/runs/peer-cli/*");
      expect(actions[0].description).toBe("peer-CLI captures");
    }
  });

  it("classifies aged operator-capture with fresh marker as operator-capture-recent", () => {
    const dir = makeProjectDir();
    const marker = renderOperatorCaptureInstructedMarker({
      lastInstructedAt: new Date(Date.now() - 1 * MS_PER_DAY).toISOString(),
    });
    blockedTask({
      projectDir: dir,
      id: "task-aged-capture-marked",
      daysAgo: 30,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/peer-cli/*",
        "description: peer-CLI captures",
      ],
      bodySuffix: marker,
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("operator-capture-recent");
  });
});

describe("listOperatorCaptureInstructCandidates", () => {
  it("returns aged operator-capture blockers without a fresh marker", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-aged",
      daysAgo: 30,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/x",
        "description: y",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidates = listOperatorCaptureInstructCandidates(records, Date.now());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].taskId).toBe("task-aged");
    expect(candidates[0].capturePath).toBe(".kota/runs/x");
  });

  it("skips fresh blockers (under threshold)", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-fresh",
      daysAgo: 5,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/x",
        "description: y",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidates = listOperatorCaptureInstructCandidates(records, Date.now());
    expect(candidates).toHaveLength(0);
  });

  it("skips aged blockers with a marker fresher than 14 days", () => {
    const dir = makeProjectDir();
    const recentMarker = renderOperatorCaptureInstructedMarker({
      lastInstructedAt: new Date(Date.now() - 1 * MS_PER_DAY).toISOString(),
    });
    blockedTask({
      projectDir: dir,
      id: "task-marker-fresh",
      daysAgo: 30,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/x",
        "description: y",
      ],
      bodySuffix: recentMarker,
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidates = listOperatorCaptureInstructCandidates(records, Date.now());
    expect(candidates).toHaveLength(0);
  });
});

describe("applyOperatorCaptureInstruction", () => {
  it("upserts the marker on a previously unmarked task body", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-aged-x",
      daysAgo: 30,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/x",
        "description: y",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidates = listOperatorCaptureInstructCandidates(records, Date.now());
    const now = new Date("2026-05-02T16:00:00.000Z");
    const result = applyOperatorCaptureInstruction({
      candidate: candidates[0],
      now,
    });
    expect(result.taskId).toBe("task-aged-x");
    expect(result.instructedAt).toBe(now.toISOString());
    const taskBody = readFileSync(candidates[0].taskPath, "utf-8");
    const marker = readOperatorCaptureInstructedMarker(taskBody);
    expect(marker?.lastInstructedAt).toBe(now.toISOString());
  });

  it("refreshes an existing marker timestamp without duplicating", () => {
    const dir = makeProjectDir();
    const stale = renderOperatorCaptureInstructedMarker({
      lastInstructedAt: new Date(Date.now() - 60 * MS_PER_DAY).toISOString(),
    });
    blockedTask({
      projectDir: dir,
      id: "task-aged-refresh",
      daysAgo: 60,
      preconditionLines: [
        "kind: operator-capture",
        "path: .kota/runs/x",
        "description: y",
      ],
      bodySuffix: stale,
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const candidates = listOperatorCaptureInstructCandidates(records, Date.now());
    const now = new Date("2026-05-02T16:00:00.000Z");
    applyOperatorCaptureInstruction({ candidate: candidates[0], now });
    const taskBody = readFileSync(candidates[0].taskPath, "utf-8");
    const matches = taskBody.match(/blocked-promoter-operator-capture-instructed/g) ?? [];
    expect(matches).toHaveLength(1);
    const marker = readOperatorCaptureInstructedMarker(taskBody);
    expect(marker?.lastInstructedAt).toBe(now.toISOString());
  });
});

describe("classifyBlockedActions includes ageDays", () => {
  it("reports ageDays alongside each action", () => {
    const dir = makeProjectDir();
    blockedTask({
      projectDir: dir,
      id: "task-aged",
      daysAgo: 7,
      preconditionLines: [
        "kind: capability-installed",
        "probe: storageState:.kota/auth.json",
      ],
    });
    const records = listBlockedTasksWithPreconditions(dir);
    const actions: BlockerAction[] = classifyBlockedActions(records, dir, Date.now());
    expect(actions[0].ageDays).toBe(7);
  });

  it("yields ageDays null when frontmatter updated_at is unparseable", () => {
    const dir = makeProjectDir();
    writeFileSync(
      join(dir, "data", "tasks", "blocked", "task-broken.md"),
      [
        "---",
        "id: task-broken",
        "title: task-broken",
        "status: blocked",
        "priority: p2",
        "area: autonomy",
        "summary: x",
        "created_at: 2026-05-02T00:00:00.000Z",
        "updated_at: not-a-date",
        "---",
        "",
        "## Problem",
        "x",
        "",
        "## Unblock Precondition",
        "",
        "```",
        "kind: capability-installed",
        "probe: playwright",
        "```",
        "",
      ].join("\n"),
    );
    const records: BlockedTaskRecord[] = listBlockedTasksWithPreconditions(dir);
    const actions = classifyBlockedActions(records, dir, Date.now());
    expect(actions[0].ageDays).toBeNull();
  });
});

describe("readOwnerAskMarkers integration", () => {
  it("parses freshly-rendered markers", () => {
    const stamp = new Date().toISOString();
    const body = `body\n\n${renderOwnerAskMarker({ slot: "pick", lastAskedAt: stamp })}\n`;
    const markers = readOwnerAskMarkers(body);
    expect(markers).toHaveLength(1);
    expect(markers[0].slot).toBe("pick");
    expect(markers[0].lastAskedAt).toBe(stamp);
  });
});
