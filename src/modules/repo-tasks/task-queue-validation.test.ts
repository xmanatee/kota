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
  type RepoTaskState,
} from "./repo-tasks-domain.js";
import {
  assertTaskQueueValid,
  validateTaskQueue,
} from "./task-queue-validation.js";

function findingCodes(repoRoot: string): string[] {
  return validateTaskQueue(repoRoot).findings.map((finding) => finding.code);
}

describe("task queue integrity", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "kota-task-integrity-"));
    mkdirSync(join(repoRoot, "data", "tasks", "archive"), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeTask(
    id: string,
    state: RepoTaskState,
    overrides: Record<string, string | string[]> = {},
    body = "Clear natural-language intent with no prescribed headings or proof artifacts.",
  ): string {
    const terminal = state === "done" || state === "dropped";
    const path = join(
      repoRoot,
      "data",
      "tasks",
      ...(terminal ? ["archive"] : []),
      `${id}.md`,
    );
    writeFileSync(
      path,
      serializeFlatFrontMatter(
        {
          status: state,
          ...(terminal ? {} : { priority: "p2" }),
          ...overrides,
        },
        `# Lean task\n\n${body}`,
      ),
      "utf8",
    );
    return path;
  }

  it("accepts and moves a clear task without class, evidence, or fixed prose sections", () => {
    const id = "task-natural-intent";
    writeTask(id, "open");

    expect(() => assertTaskQueueValid(repoRoot)).not.toThrow();
    expect(moveTaskById(repoRoot, id, "done")).toMatchObject({
      fromState: "open",
      toState: "done",
    });
  });

  it("rejects malformed or duplicate frontmatter fields", () => {
    const path = join(
      repoRoot,
      "data",
      "tasks",
      "task-malformed.md",
    );
    writeFileSync(path, "---\nstatus: open\nstatus: open\nbroken\n---\n# Intent\n");

    expect(findingCodes(repoRoot)).toContain("task-frontmatter-invalid");
  });

  it("checks filename identity and root/archive state agreement", () => {
    writeTask("bad_id", "open", {
      status: "done",
    });

    expect(findingCodes(repoRoot)).toEqual(expect.arrayContaining([
      "task-id-invalid",
      "task-container-mismatch",
    ]));
  });

  it("checks minimal active metadata and body title without interpreting prose", () => {
    const path = join(repoRoot, "data", "tasks", "task-bad-metadata.md");
    writeFileSync(
      path,
      "---\nstatus: open\npriority: urgent\nupdated_at: yesterday-ish\n---\nNo title.\n",
    );

    expect(findingCodes(repoRoot)).toEqual(expect.arrayContaining([
      "task-priority-invalid",
      "task-attr-unnecessary",
      "task-title-missing",
    ]));
  });

  it("rejects missing, duplicate, and self dependencies", () => {
    writeTask("task-dependencies", "open", {
      depends_on: [
        "task-missing",
        "task-missing",
        "task-dependencies",
      ],
    });

    expect(findingCodes(repoRoot)).toEqual(expect.arrayContaining([
      "task-dependency-missing",
      "task-dependency-duplicate",
      "task-dependency-self",
    ]));
  });

  it("rejects dependency cycles", () => {
    writeTask("task-cycle-a", "open", { depends_on: ["task-cycle-b"] });
    writeTask("task-cycle-b", "open", { depends_on: ["task-cycle-a"] });

    expect(findingCodes(repoRoot)).toContain("task-dependency-cycle");
  });

  it("rejects live work that depends on a dropped task", () => {
    writeTask("task-retired", "dropped");
    writeTask("task-live", "open", { depends_on: ["task-retired"] });

    expect(findingCodes(repoRoot)).toContain("task-dependency-dropped");
  });

  it("requires blocked tasks to declare one parseable precondition", () => {
    writeTask("task-blocked", "blocked");

    expect(findingCodes(repoRoot)).toContain("blocked-task-precondition-invalid");
  });

  it("rejects the same id in more than one state", () => {
    writeTask("task-duplicate", "open");
    writeTask("task-duplicate", "done");

    expect(findingCodes(repoRoot)).toContain("task-duplicate");
  });

  it("rejects linked task entries", () => {
    const target = writeTask("task-target", "open");
    symlinkSync(
      target,
      join(repoRoot, "data", "tasks", "task-linked.md"),
    );
    expect(findingCodes(repoRoot)).toContain("task-path-unsafe");
  });

  it("does not turn package-manager wording, diff preferences, or evidence terms into errors", () => {
    writeTask(
      "task-prose-is-not-policy",
      "open",
      {},
      "The owner mentioned npm, a small diff, screenshots, and an inaccessible source. Review the actual desired behavior instead of classifying these words.",
    );

    expect(() => assertTaskQueueValid(repoRoot)).not.toThrow();
  });
});
