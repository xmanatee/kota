import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  moveTaskById,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "./repo-tasks-domain.js";
import {
  assertTaskQueueValid,
  validateTaskQueue,
} from "./task-queue-validation.js";

function findingCodes(projectDir: string): string[] {
  return validateTaskQueue(projectDir).findings.map((finding) => finding.code);
}

describe("task queue integrity", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-task-integrity-"));
    for (const state of REPO_TASK_STATES) {
      mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeTask(
    id: string,
    state: RepoTaskState,
    overrides: Record<string, string | string[]> = {},
    body = "Clear natural-language intent with no prescribed headings or proof artifacts.",
  ): string {
    const path = join(projectDir, "data", "tasks", state, `${id}.md`);
    writeFileSync(
      path,
      serializeFlatFrontMatter(
        {
          id,
          title: "Lean task",
          status: state,
          priority: "p2",
          area: "core",
          summary: "Preserve one clear outcome.",
          created_at: "2026-08-26T00:00:00.000Z",
          updated_at: "2026-08-26T00:00:00.000Z",
          ...overrides,
        },
        body,
      ),
      "utf8",
    );
    return path;
  }

  it("accepts and moves a clear task without class, evidence, or fixed prose sections", () => {
    const id = "task-natural-intent";
    writeTask(id, "backlog");

    expect(() => assertTaskQueueValid(projectDir)).not.toThrow();
    expect(moveTaskById(projectDir, id, "ready")).toMatchObject({
      fromState: "backlog",
      toState: "ready",
    });
    expect(moveTaskById(projectDir, id, "done")).toMatchObject({
      fromState: "ready",
      toState: "done",
    });
  });

  it("rejects malformed or duplicate frontmatter fields", () => {
    const path = join(
      projectDir,
      "data",
      "tasks",
      "backlog",
      "task-malformed.md",
    );
    writeFileSync(path, "---\nid: task-malformed\nid: task-malformed\nbroken\n---\nIntent\n");

    expect(findingCodes(projectDir)).toContain("task-frontmatter-invalid");
  });

  it("checks task id, filename, and state agreement", () => {
    writeTask("bad_id", "backlog", {
      id: "task-other",
      status: "ready",
    });

    expect(findingCodes(projectDir)).toEqual(expect.arrayContaining([
      "task-id-invalid",
      "task-id-mismatch",
      "task-status-mismatch",
    ]));
  });

  it("checks required routing metadata without interpreting task prose", () => {
    writeTask("task-bad-metadata", "backlog", {
      title: "",
      priority: "urgent",
      updated_at: "yesterday-ish",
    });

    expect(findingCodes(projectDir)).toEqual(expect.arrayContaining([
      "task-missing-required-attr",
      "task-invalid-priority",
      "task-date-invalid",
    ]));
  });

  it("rejects missing, duplicate, and self dependencies", () => {
    writeTask("task-dependencies", "backlog", {
      depends_on: [
        "task-missing",
        "task-missing",
        "task-dependencies",
      ],
    });

    expect(findingCodes(projectDir)).toEqual(expect.arrayContaining([
      "task-dependency-missing",
      "task-dependency-duplicate",
      "task-dependency-self",
    ]));
  });

  it("rejects dependency cycles", () => {
    writeTask("task-cycle-a", "backlog", { depends_on: ["task-cycle-b"] });
    writeTask("task-cycle-b", "backlog", { depends_on: ["task-cycle-a"] });

    expect(findingCodes(projectDir)).toContain("task-dependency-cycle");
  });

  it("rejects live work that depends on a dropped task", () => {
    writeTask("task-retired", "dropped");
    writeTask("task-live", "backlog", { depends_on: ["task-retired"] });

    expect(findingCodes(projectDir)).toContain("task-dependency-dropped");
  });

  it("requires blocked tasks to declare one parseable precondition", () => {
    writeTask("task-blocked", "blocked");

    expect(findingCodes(projectDir)).toContain("blocked-task-precondition-invalid");
  });

  it("keeps task-done preconditions aligned with the dependency edge", () => {
    writeTask("task-enabler", "backlog");
    writeTask(
      "task-blocked",
      "blocked",
      { depends_on: [] },
      "## Unblock Precondition\n\n```\nkind: task-done\nref: task-enabler\n```",
    );

    expect(findingCodes(projectDir)).toContain(
      "blocked-task-done-dependency-mismatch",
    );
  });

  it("rejects the same id in more than one state", () => {
    writeTask("task-duplicate", "backlog");
    writeTask("task-duplicate", "ready");

    expect(findingCodes(projectDir)).toContain("task-duplicate-state");
  });

  it("rejects linked task entries and runtime state nested under data", () => {
    const target = writeTask("task-target", "backlog");
    symlinkSync(
      target,
      join(projectDir, "data", "tasks", "ready", "task-linked.md"),
    );
    mkdirSync(join(projectDir, "data", "nested", ".kota"), { recursive: true });

    expect(findingCodes(projectDir)).toEqual(expect.arrayContaining([
      "task-path-unsafe",
      "data-nested-runtime-state",
    ]));
  });

  it("does not turn package-manager wording, diff preferences, or evidence terms into errors", () => {
    writeTask(
      "task-prose-is-not-policy",
      "backlog",
      {},
      "The owner mentioned npm, a small diff, screenshots, and an inaccessible source. Review the actual desired behavior instead of classifying these words.",
    );

    expect(() => assertTaskQueueValid(projectDir)).not.toThrow();
  });
});
