import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { moveTaskById, reopenTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { checkTargetTaskResolved } from "./task-state-repair-checks.js";

let root: string;

function writeTask(id: string, state: "open" | "blocked" | "done", notes = ""): string {
  const path = join(root, "data/tasks", ...(state === "done" ? ["archive"] : []), `${id}.md`);
  writeFileSync(path, serializeFlatFrontMatter({
    status: state,
    ...(state === "done" ? {} : { priority: "p1" }),
  }, `# ${id}\n\n${notes}\n${state === "blocked" ? "\n## Blocked on\nkind: operator-capture\npath: evidence\ndescription: External evidence required\n" : ""}`));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "builder-task-states-"));
  mkdirSync(join(root, "data/tasks/archive"), { recursive: true });
  writeTask("task-target", "open");
  writeTask("task-other", "open");
  writeTask("task-waiting", "blocked");
  writeTask("task-completed", "done");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-qm", "seed"]);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it("allows evidence notes without misclassifying unchanged task states as completion", () => {
  moveTaskById(root, "task-target", "done");
  writeTask("task-waiting", "blocked", "Related evidence was collected; prerequisite remains external.");
  writeTask("task-completed", "done", "Updated evidence citation.");
  writeTask("task-followup", "open", "Independent useful follow-up.");
  expect(checkTargetTaskResolved(root, "task-target")).toContain("OK");
});

it.each(["delete", "reopen", "complete", "block"] as const)(
  "rejects a non-target task state change: %s",
  (change) => {
    moveTaskById(root, "task-target", "done");
    if (change === "delete") rmSync(join(root, "data/tasks/task-other.md"));
    else if (change === "reopen") reopenTaskById(root, "task-completed", "p1");
    else if (change === "complete") moveTaskById(root, "task-other", "done");
    else writeTask("task-other", "blocked");
    expect(() => checkTargetTaskResolved(root, "task-target")).toThrow(/only the targeted task/i);
  },
);

it("does not accept an unchanged target disposition as a new transition", () => {
  const original = readFileSync(join(root, "data/tasks/task-target.md"), "utf8");
  writeFileSync(join(root, "data/tasks/task-target.md"), `${original}\nStill implementing.\n`);
  expect(() => checkTargetTaskResolved(root, "task-target")).toThrow(/done, blocked, or dropped/);
});

it.each(["done", "blocked"] as const)("rejects inventing a resolved non-target task: %s", (state) => {
  moveTaskById(root, "task-target", "done");
  writeTask("task-invented", state);
  expect(() => checkTargetTaskResolved(root, "task-target")).toThrow(/only the targeted task/i);
});
