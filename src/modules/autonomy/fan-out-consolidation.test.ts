import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  declaresRenderedEvidence,
  hasNamedRenderedEvidence,
} from "#modules/repo-tasks/task-queue-validation.js";
import {
  buildConsolidationTaskBody,
  buildConsolidationTaskFile,
  consolidationTaskIdForCapability,
  detectFanOutBatches,
  detectPrimarySurface,
  extractCapabilityKey,
  type FanOutBatch,
  proposeConsolidationActions,
  seedFanOutConsolidationTasks,
} from "./fan-out-consolidation.js";

function mkRecord(opts: Partial<RepoTaskFullRecord> & {
  id: string;
  title: string;
  updatedAt: string;
}): RepoTaskFullRecord {
  return {
    id: opts.id,
    title: opts.title,
    state: opts.state ?? "done",
    priority: opts.priority ?? "p2",
    area: opts.area ?? "client",
    summary: opts.summary ?? "",
    updatedAt: opts.updatedAt,
    body: opts.body ?? "",
    dependsOn: opts.dependsOn ?? [],
    anchor: opts.anchor ?? false,
  };
}

const NOW = Date.parse("2026-05-02T20:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const RETRACT_FAN_OUT_RECORDS: RepoTaskFullRecord[] = [
  mkRecord({
    id: "task-add-cross-store-retract-seam",
    title: "Add cross-store retract seam mirroring capture",
    area: "modules",
    summary: "Define a cross-store retract seam returning typed RetractResult arms.",
    updatedAt: new Date(NOW - 6 * DAY).toISOString(),
  }),
  mkRecord({
    id: "task-telegram-retract",
    title: "Land Telegram /retract-<store> commands consuming the cross-store retract seam",
    area: "channel",
    summary: "Wire /retract-<store> Telegram commands.",
    updatedAt: new Date(NOW - 5 * DAY).toISOString(),
  }),
  mkRecord({
    id: "task-web-retract-panel",
    title: "Add web RetractPanel consuming the cross-store retract seam",
    area: "client",
    summary: "Add a RetractPanel to the web client.",
    updatedAt: new Date(NOW - 4 * DAY).toISOString(),
  }),
  mkRecord({
    id: "task-macos-daemon-client-retract",
    title: "Add macOS DaemonClient.retract with discriminated RetractResult types",
    area: "client",
    summary: "Extend the macOS DaemonClient to call /retract.",
    updatedAt: new Date(NOW - 3 * DAY).toISOString(),
  }),
  mkRecord({
    id: "task-macos-retract-view",
    title: "Add macOS menu-bar RetractView consuming DaemonClient.retract",
    area: "client",
    summary: "Wire a RetractView into the macOS menu bar.",
    updatedAt: new Date(NOW - 2 * DAY).toISOString(),
  }),
  mkRecord({
    id: "task-mobile-retract-screen",
    title: "Add mobile RetractScreen consuming a new DaemonClient.retract",
    area: "client",
    summary: "Add a mobile RetractScreen to the React Native client.",
    updatedAt: new Date(NOW - 1 * DAY).toISOString(),
  }),
];

describe("extractCapabilityKey", () => {
  it("extracts the capability noun from a fan-out title", () => {
    expect(
      extractCapabilityKey(
        "Add macOS DaemonClient.retract with discriminated RetractResult types",
        "Extend the macOS DaemonClient to call /retract.",
      ),
    ).toBe("retract");
    expect(
      extractCapabilityKey(
        "Add web RetractPanel consuming the cross-store retract seam",
        "",
      ),
    ).toBe("retract");
    expect(
      extractCapabilityKey(
        "Land Telegram /retract-<store> commands consuming the cross-store retract seam",
        "",
      ),
    ).toBe("retract");
    expect(
      extractCapabilityKey(
        "Add mobile RetractScreen consuming a new DaemonClient.retract",
        "",
      ),
    ).toBe("retract");
  });

  it("returns null when no capability noun can be extracted", () => {
    expect(
      extractCapabilityKey(
        "Refactor internal helper into shared utility",
        "Move a helper into shared utilities; no behavior change.",
      ),
    ).toBeNull();
  });

  it("does not let summary context override the capability named in the title", () => {
    expect(
      extractCapabilityKey(
        "Add a Telegram /memory command for ad-hoc semantic memory search",
        "Mirror the /knowledge command for the memory store.",
      ),
    ).toBe("memory");
  });
});

describe("detectFanOutBatches", () => {
  it("fires on a representative multi-client fan-out sequence", () => {
    const batches = detectFanOutBatches(RETRACT_FAN_OUT_RECORDS, { nowMs: NOW });
    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    expect(batch.capabilityKey).toBe("retract");
    const distinctSurfaces = new Set(batch.surfaces.map((s) => s.surface));
    expect(distinctSurfaces.size).toBeGreaterThanOrEqual(3);
    expect(distinctSurfaces.has("telegram")).toBe(true);
    expect(distinctSurfaces.has("web")).toBe(true);
    expect(distinctSurfaces.has("macos")).toBe(true);
    expect(distinctSurfaces.has("mobile")).toBe(true);
  });

  it("counts one primary surface per task instead of every contextual surface mention", () => {
    const batches = detectFanOutBatches(RETRACT_FAN_OUT_RECORDS, { nowMs: NOW });
    const batch = batches[0]!;
    const taskIds = batch.surfaces.map((entry) => entry.taskId);

    expect(taskIds).toHaveLength(new Set(taskIds).size);
    expect(batch.surfaces.find((entry) => entry.taskId === "task-macos-daemon-client-retract")?.surface)
      .toBe("macos");
    expect(batch.surfaces.find((entry) => entry.taskId === "task-mobile-retract-screen")?.surface)
      .toBe("mobile");
  });

  it("does not turn backend/integration coverage into a synthetic multi-surface batch", () => {
    const records: RepoTaskFullRecord[] = [
      mkRecord({
        id: "task-add-recall-plus-cited-answer-plus-answer-history-e",
        title: "Add recall plus cited-answer plus answer-history end-to-end integration test",
        area: "client",
        summary: "Exercise the daemon routes and persisted answer-history contract.",
        updatedAt: new Date(NOW - 1 * DAY).toISOString(),
      }),
    ];

    expect(detectFanOutBatches(records, { nowMs: NOW })).toHaveLength(0);
  });

  it("does not fire on unrelated single-surface tasks", () => {
    const records: RepoTaskFullRecord[] = [
      mkRecord({
        id: "task-tighten-something-internal",
        title: "Tighten internal protocol invariant",
        area: "core",
        summary: "Tighten a typed protocol invariant; no client touched.",
        updatedAt: new Date(NOW - 2 * DAY).toISOString(),
      }),
      mkRecord({
        id: "task-add-mobile-only-screen",
        title: "Add mobile WelcomeScreen onboarding flow",
        area: "client",
        summary: "Add a single-surface WelcomeScreen.",
        updatedAt: new Date(NOW - 1 * DAY).toISOString(),
      }),
    ];
    expect(detectFanOutBatches(records, { nowMs: NOW })).toHaveLength(0);
  });

  it("does not fire when fewer than minSurfaces distinct surfaces shipped", () => {
    const partial = RETRACT_FAN_OUT_RECORDS.slice(0, 3);
    const distinctSurfaces = new Set<string>();
    for (const r of partial) {
      if (/macos/i.test(r.title)) distinctSurfaces.add("macos");
      if (/telegram/i.test(r.title)) distinctSurfaces.add("telegram");
      if (/web/i.test(r.title)) distinctSurfaces.add("web");
      if (/mobile/i.test(r.title)) distinctSurfaces.add("mobile");
    }
    const batches = detectFanOutBatches(partial, { nowMs: NOW, minSurfaces: 5 });
    expect(batches).toHaveLength(0);
  });

  it("ignores closures outside the rolling window", () => {
    const stale = RETRACT_FAN_OUT_RECORDS.map((r, i) =>
      mkRecord({ ...r, updatedAt: new Date(NOW - (40 + i) * DAY).toISOString() }),
    );
    expect(detectFanOutBatches(stale, { nowMs: NOW })).toHaveLength(0);
  });

  it("does not fire on tasks still open", () => {
    const stillOpen = RETRACT_FAN_OUT_RECORDS.map((r) => mkRecord({ ...r, state: "ready" }));
    expect(detectFanOutBatches(stillOpen, { nowMs: NOW })).toHaveLength(0);
  });
});

describe("detectPrimarySurface", () => {
  it("prefers the owning client surface over daemon-context wording", () => {
    expect(
      detectPrimarySurface(
        "Add macOS DaemonClient.answer with discriminated AnswerResult types",
        "Extend the macOS DaemonClient to call /answer.",
      ),
    ).toBe("macos");
    expect(
      detectPrimarySurface(
        "Add mobile AnswerScreen consuming DaemonClient.answer",
        "Uses the same daemon route the CLI and web clients consume.",
      ),
    ).toBe("mobile");
    expect(
      detectPrimarySurface(
        "Add web AnswerHistoryPanel consuming the answer-history seam",
        "Mentions macOS and mobile adoption in the summary.",
      ),
    ).toBe("web");
  });

  it("recognizes daemon-only route work without assigning client surfaces", () => {
    expect(
      detectPrimarySurface(
        "Add daemon HTTP endpoint for cross-store recall",
        "Expose /api/recall with a typed envelope.",
      ),
    ).toBe("daemon");
  });
});

describe("consolidation task body", () => {
  function makeBatch(): FanOutBatch {
    return detectFanOutBatches(RETRACT_FAN_OUT_RECORDS, { nowMs: NOW })[0]!;
  }

  it("includes every required consolidation dimension as a numbered Done When item", () => {
    const body = buildConsolidationTaskBody(makeBatch());
    const dimensions = [
      "Information architecture",
      "Cross-client capability contract",
      "Duplicated route/error/rendering logic",
      "Provider readiness and unavailable state",
      "Live runtime/screenshot/transcript evidence",
      "Stale legacy affordances",
      "Docs/AGENTS reality check",
      "Accepted critic warning review",
    ];
    for (const dim of dimensions) {
      expect(body).toContain(dim);
    }
    const numberedMatches = body.match(/^\d+\.\s\*\*/gm) ?? [];
    expect(numberedMatches.length).toBe(8);
  });

  it("acceptance evidence names rendered/runtime artifact kinds (so per-surface tests cannot satisfy it)", () => {
    const body = buildConsolidationTaskBody(makeBatch());
    const file = `---\nid: x\n---\n${body}`;
    expect(declaresRenderedEvidence(file)).toBe(true);
    expect(hasNamedRenderedEvidence(file)).toBe(true);
  });

  it("removing the rendered-artifact bullets from acceptance evidence flips the gate to fail (critic-fixture)", () => {
    const body = buildConsolidationTaskBody(makeBatch());
    const stripped = body.replace(/## Acceptance Evidence[\s\S]*$/, "## Acceptance Evidence\n\n- Per-surface unit tests pass.\n");
    const file = `---\nid: x\n---\n${stripped}`;
    expect(declaresRenderedEvidence(file)).toBe(true);
    expect(hasNamedRenderedEvidence(file)).toBe(false);
  });

  it("buildConsolidationTaskFile produces a parseable normalized task with area=client and priority=p2", () => {
    const file = buildConsolidationTaskFile(
      consolidationTaskIdForCapability("retract"),
      makeBatch(),
      "2026-05-02T20:30:00.000Z",
    );
    expect(file).toContain("status: ready");
    expect(file).toContain("priority: p2");
    expect(file).toContain("area: client");
    expect(file).toContain(`id: ${consolidationTaskIdForCapability("retract")}`);
  });
});

describe("seedFanOutConsolidationTasks", () => {
  function setupRepo(records: RepoTaskFullRecord[]): string {
    const repoDir = mkdtempSync(join(tmpdir(), "kota-fan-out-"));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: repoDir });
    const doneDir = join(repoDir, "data", "tasks", "done");
    mkdirSync(doneDir, { recursive: true });
    mkdirSync(join(repoDir, "data", "tasks", "ready"), { recursive: true });
    for (const record of records) {
      const attrs: Record<string, string> = {
        id: record.id,
        title: record.title,
        status: record.state,
        priority: record.priority,
        area: record.area,
        summary: record.summary,
        created_at: record.updatedAt,
        updated_at: record.updatedAt,
      };
      const path = join(doneDir, `${record.id}.md`);
      writeFileSync(path, serializeFlatFrontMatter(attrs, "\n## Problem\n\n## Desired Outcome\n\n## Constraints\n\n## Done When\n"));
    }
    writeFileSync(join(repoDir, ".gitkeep"), "");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });
    return repoDir;
  }

  it("seeds a consolidation task in ready/ on first detection, then is idempotent", () => {
    const repoDir = setupRepo(RETRACT_FAN_OUT_RECORDS);
    try {
      const first = seedFanOutConsolidationTasks({
        projectDir: repoDir,
        nowMs: NOW,
        nowIso: new Date(NOW).toISOString(),
      });
      expect(first.touchedDisk).toBe(true);
      expect(first.artifact.applied.find((a) => a.kind === "created")?.taskId).toBe(
        consolidationTaskIdForCapability("retract"),
      );
      const seededPath = join(
        repoDir,
        "data",
        "tasks",
        "ready",
        `${consolidationTaskIdForCapability("retract")}.md`,
      );
      expect(existsSync(seededPath)).toBe(true);
      const written = readFileSync(seededPath, "utf-8");
      expect(written).toMatch(/area: client/);
      expect(written).toMatch(/Information architecture/);

      execFileSync("git", ["add", "-A"], { cwd: repoDir });
      execFileSync("git", ["commit", "-m", "seed consolidation"], { cwd: repoDir });

      const second = seedFanOutConsolidationTasks({
        projectDir: repoDir,
        nowMs: NOW,
        nowIso: new Date(NOW).toISOString(),
      });
      expect(second.touchedDisk).toBe(false);
      expect(second.artifact.applied.every((a) => a.kind === "noop")).toBe(true);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("does not seed when no fan-out batch is detected", () => {
    const repoDir = setupRepo([]);
    try {
      const result = seedFanOutConsolidationTasks({
        projectDir: repoDir,
        nowMs: NOW,
        nowIso: new Date(NOW).toISOString(),
      });
      expect(result.touchedDisk).toBe(false);
      expect(result.artifact.batches).toHaveLength(0);
      expect(result.artifact.applied).toHaveLength(0);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("proposeConsolidationActions", () => {
  it("flips to noop when an existing consolidation task lives in any state", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "kota-fan-out-existing-"));
    try {
      const blockedDir = join(repoDir, "data", "tasks", "blocked");
      mkdirSync(blockedDir, { recursive: true });
      writeFileSync(
        join(blockedDir, `${consolidationTaskIdForCapability("retract")}.md`),
        "---\nid: task-fan-out-consolidation-retract\n---\n",
      );
      const batches = detectFanOutBatches(RETRACT_FAN_OUT_RECORDS, { nowMs: NOW });
      const proposals = proposeConsolidationActions(repoDir, batches);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.action).toBe("noop");
      if (proposals[0]!.action === "noop") {
        expect(proposals[0]!.existingState).toBe("blocked");
      }
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
