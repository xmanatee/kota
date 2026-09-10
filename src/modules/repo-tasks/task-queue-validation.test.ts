import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { readGitTextTree } from "#core/util/repository-tree.js";
import { readPublishedRepoTaskQueue } from "./published-task-queue.js";
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

  it("rejects empty intent and exact default text without prescribing sections or language", () => {
    writeTask("task-authored", "open", {}, "\n## Problem\n\n<!-- unfinished -->\n## Outcome\n");
    expect(findingCodes(repoRoot)).toContain("task-intent-empty");
    writeTask("task-authored", "open", {}, "Describe the problem and why it matters.");
    expect(findingCodes(repoRoot)).toContain("task-intent-placeholder");
    writeTask("task-authored", "open", {}, "Corriger la recherche. Conserver les mots TODO et npm dans les exemples.");
    expect(() => assertTaskQueueValid(repoRoot)).not.toThrow();
  });

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  function commit(): string {
    git("-c", "user.name=KOTA Test", "-c", "user.email=kota@example.test", "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", "Published task intent");
    return git("rev-parse", "HEAD");
  }

  it("validates index blobs independently of partial working-tree saves and keeps HEAD intake coherent", () => {
    git("init", "--quiet");
    const path = writeTask("task-authored", "open");
    git("add", "data");
    const head = commit();
    const published = readPublishedRepoTaskQueue(repoRoot);
    writeFileSync(path, "---\nstatus: open\n");
    expect(validateTaskQueue(repoRoot).errorCount).toBeGreaterThan(0);
    expect(assertTaskQueueValid(repoRoot, readGitTextTree(repoRoot, "index", ["data/tasks"]).tree).errorCount).toBe(0);
    expect(readPublishedRepoTaskQueue(repoRoot)).toEqual(published);
    expect(published.queue.headSha).toBe(head);

    git("add", "data");
    writeTask("task-authored", "open", {}, "A complete unstaged correction.");
    expect(validateTaskQueue(repoRoot).errorCount).toBe(0);
    expect(() => assertTaskQueueValid(repoRoot, readGitTextTree(repoRoot, "index", ["data/tasks"]).tree)).toThrow("task-frontmatter-invalid");
    expect(readPublishedRepoTaskQueue(repoRoot)).toEqual(published);

    mkdirSync(join(repoRoot, "data/inbox"));
    writeFileSync(join(repoRoot, "data/inbox/idea.md"), "An unfinished capture");
    expect(readPublishedRepoTaskQueue(repoRoot).queue.inboxCount).toBe(0);
    git("add", "data");
    const nextHead = commit();
    expect(readPublishedRepoTaskQueue(repoRoot).queue).toMatchObject({ headSha: nextHead, inboxCount: 1 });
    expect(published.queue.headSha).toBe(head);
  });

  it("rejects staged predecessor deletion, unmerged entries, and unsafe containers in nested scopes", () => {
    git("init", "--quiet");
    const predecessor = writeTask("task-predecessor", "done");
    writeTask("task-dependent", "open", { depends_on: ["task-predecessor"] });
    git("add", "data");
    commit();
    git("rm", "--cached", predecessor);
    expect(() => assertTaskQueueValid(repoRoot, readGitTextTree(repoRoot, "index", ["data/tasks"]).tree)).toThrow("task-dependency-missing");
    git("add", "data");
    const oid = git("rev-parse", "HEAD:data/tasks/task-dependent.md");
    execFileSync("git", ["update-index", "--index-info"], { cwd: repoRoot, input: `0 ${"0".repeat(40)}\tdata/tasks/task-dependent.md\n100644 ${oid} 1\tdata/tasks/task-dependent.md\n100644 ${oid} 2\tdata/tasks/task-dependent.md\n` });
    expect(() => readGitTextTree(repoRoot, "index", ["data/tasks"])).toThrow("Unmerged index entry");

    const nested = join(repoRoot, "nested project");
    mkdirSync(nested);
    symlinkSync("../data", join(nested, "data"));
    git("add", "nested project/data");
    expect(() => assertTaskQueueValid(nested, readGitTextTree(nested, "index", ["data/tasks"]).tree)).toThrow("task-path-unsafe");
  });

  it("distinguishes unborn publication from non-Git and corrupt HEAD while preserving working inspection", () => {
    writeTask("task-authored", "open");
    expect(validateTaskQueue(repoRoot).errorCount).toBe(0);
    expect(() => readPublishedRepoTaskQueue(repoRoot)).toThrow("Cannot read repository HEAD snapshot");
    git("init", "--quiet");
    expect(readPublishedRepoTaskQueue(repoRoot)).toMatchObject({
      tasks: [], queue: { headSha: "", activeCount: 0, actionableCount: 0, inboxCount: 0 },
    });
    writeFileSync(join(repoRoot, ".git/HEAD"), `${"a".repeat(40)}\n`);
    expect(() => readPublishedRepoTaskQueue(repoRoot)).toThrow("Cannot read repository HEAD snapshot");
  });

  it("runs the staged CLI gate and installs a tracked hook without replacing user hooks", () => {
    git("init", "--quiet");
    const path = writeTask("task-authored", "open", {}, "");
    git("add", "data");
    writeTask("task-authored", "open");
    const require = createRequire(import.meta.url);
    const cli = new URL("../../validate-queue.ts", import.meta.url);
    const run = () => spawnSync(process.execPath, ["--conditions=source", "--import", require.resolve("tsx"), cli.pathname, "--staged"], { cwd: repoRoot, encoding: "utf8" });
    expect(run()).toMatchObject({ status: 1, stderr: expect.stringContaining("task-intent-empty") });
    git("add", "data");
    writeFileSync(path, "unfinished save");
    expect(run().status).toBe(0);

    mkdirSync(join(repoRoot, ".githooks"));
    copyFileSync(new URL("../../../.githooks/pre-commit", import.meta.url), join(repoRoot, ".githooks/pre-commit"));
    const installer = new URL("../../../scripts/install-task-hook.mjs", import.meta.url);
    const install = () => spawnSync(process.execPath, [installer.pathname], { cwd: repoRoot, encoding: "utf8" });
    git("config", "core.hooksPath", "user-hooks");
    expect(install()).toMatchObject({ status: 1, stderr: expect.stringContaining("preserved") });
    expect(git("config", "core.hooksPath")).toBe("user-hooks");
    git("config", "--unset", "core.hooksPath");
    writeFileSync(join(repoRoot, ".git/hooks/pre-commit"), "user hook");
    expect(install().status).toBe(1);
    rmSync(join(repoRoot, ".git/hooks/pre-commit"));
    expect(install().status).toBe(0);
    expect(git("config", "core.hooksPath")).toBe(".githooks");
    expect(install().status).toBe(0);
  });
});
