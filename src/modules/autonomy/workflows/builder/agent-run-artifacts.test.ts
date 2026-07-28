import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateTaskQueue } from "#modules/repo-tasks/task-queue-validation.js";
import {
  checkAgentRunArtifactsReady,
  checkBuilderWorkflowChangesStageable,
  commitBuilderWorkflowChanges,
  projectAgentRunArtifactsForValidation,
} from "./agent-run-artifacts.js";
import {
  BUILDER_EVIDENCE_MANIFEST_FILE,
  type BuilderEvidenceArtifactKind,
} from "./agent-run-evidence-manifest.js";

const tempDirs: string[] = [];

function initRepo(options: { ignoreKota?: boolean } = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "kota-agent-run-artifacts-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  if (options.ignoreKota !== false) {
    writeFileSync(join(repo, ".gitignore"), "/.kota/*\n", "utf8");
  }
  writeFileSync(join(repo, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: repo });
  return repo;
}

function writeManifest(
  agentRunDir: string,
  artifacts: Array<{ path: string; kind: BuilderEvidenceArtifactKind }> = [],
): void {
  writeFileSync(
    join(agentRunDir, BUILDER_EVIDENCE_MANIFEST_FILE),
    `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`,
    "utf8",
  );
}

function artifactRoot(agentRunDir: string): string {
  const root = join(agentRunDir, "artifacts");
  mkdirSync(root, { recursive: true });
  return root;
}

function writeRequiredArtifacts(agentRunDir: string): void {
  mkdirSync(agentRunDir, { recursive: true });
  writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. First\n2. Second\n", "utf8");
  writeFileSync(
    join(agentRunDir, "success-criteria-verified.txt"),
    "1. First verified\n2. Second verified\n",
    "utf8",
  );
  writeFileSync(join(agentRunDir, "commit-message.txt"), "Builder: test\n", "utf8");
  writeManifest(agentRunDir);
}

function trackedFiles(repo: string): string[] {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim().split("\n");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("builder agent run artifacts", () => {
  it("commits only registered worktree evidence when the evidence source is not ignored", () => {
    const repo = initRepo({ ignoreKota: false });
    const agentRunDir = join(repo, ".kota", "builder-evidence", "run-worktree");
    writeRequiredArtifacts(agentRunDir);
    const artifacts = artifactRoot(agentRunDir);
    writeFileSync(join(artifacts, "unexpected-credentials.env"), "OPENAI_API_KEY=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", "utf8");
    writeFileSync(join(artifacts, "validation.txt"), "pnpm test: passed\n", "utf8");
    writeManifest(agentRunDir, [{ path: "validation.txt", kind: "text" }]);
    writeFileSync(join(repo, "change.txt"), "implementation\n", "utf8");

    expect(checkAgentRunArtifactsReady(agentRunDir, repo)).toMatch(
      /^OK: 5 registered builder evidence file\(s\), \d+ byte\(s\) ready$/,
    );
    expect(checkBuilderWorkflowChangesStageable(repo, agentRunDir)).toBe(
      "OK: 1 mutated path(s) stageable",
    );
    expect(commitBuilderWorkflowChanges(repo, agentRunDir)).toMatchObject({
      committed: true,
      message: "Builder: test",
    });

    const committed = trackedFiles(repo);
    expect(committed).toContain(".kota/runs/run-worktree/evidence/artifacts/validation.txt");
    expect(committed).toContain(".kota/runs/run-worktree/evidence/success-criteria.txt");
    expect(committed).not.toContain(".kota/runs/run-worktree/evidence/artifacts/unexpected-credentials.env");
    expect(committed).not.toContain(".kota/builder-evidence/run-worktree/artifacts/validation.txt");
    expect(committed).not.toContain(".kota/builder-evidence/run-worktree/success-criteria.txt");
    expect(committed).toContain("change.txt");
    expect(
      execFileSync(
        "git",
        ["status", "--short", "--untracked-files=all", "--", ".kota/builder-evidence"],
        { cwd: repo, encoding: "utf8" },
      ),
    ).toContain("?? .kota/builder-evidence/run-worktree/artifacts/unexpected-credentials.env");
  });

  it("keeps canonical serial-mode workflow artifacts outside the commit without ignore rules", () => {
    const repo = initRepo({ ignoreKota: false });
    const canonicalRunDir = join(repo, ".kota", "runs", "run-serial");
    const agentRunDir = join(repo, ".kota", "builder-evidence", "run-serial");
    writeRequiredArtifacts(agentRunDir);
    mkdirSync(join(canonicalRunDir, "steps"), { recursive: true });
    writeFileSync(join(canonicalRunDir, "prompt.md"), "runtime prompt\n", "utf8");
    writeFileSync(join(canonicalRunDir, "steps", "build.json"), "{\"output\":\"runtime only\"}\n", "utf8");
    writeFileSync(join(canonicalRunDir, "credentials.env"), "TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", "utf8");
    writeFileSync(join(repo, "change.txt"), "implementation\n", "utf8");

    commitBuilderWorkflowChanges(repo, agentRunDir);

    const committed = trackedFiles(repo);
    expect(committed).not.toContain(".kota/runs/run-serial/prompt.md");
    expect(committed).not.toContain(".kota/runs/run-serial/steps/build.json");
    expect(committed).not.toContain(".kota/runs/run-serial/credentials.env");
    expect(committed).toContain(".kota/runs/run-serial/evidence/evidence-manifest.json");
  });

  it("keeps sibling runtime and evidence namespaces outside the commit without ignore rules", () => {
    const repo = initRepo({ ignoreKota: false });
    const agentRunDir = join(repo, ".kota", "builder-evidence", "run-current");
    writeRequiredArtifacts(agentRunDir);
    const siblingRunDir = join(repo, ".kota", "runs", "run-sibling");
    mkdirSync(join(siblingRunDir, "steps"), { recursive: true });
    writeFileSync(
      join(siblingRunDir, "steps", "build.json"),
      '{"output":"runtime only"}\n',
      "utf8",
    );
    writeFileSync(
      join(siblingRunDir, "credentials.env"),
      "TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
      "utf8",
    );
    const siblingEvidenceDir = join(
      repo,
      ".kota",
      "builder-evidence",
      "run-sibling",
    );
    mkdirSync(siblingEvidenceDir, { recursive: true });
    writeFileSync(
      join(siblingEvidenceDir, "credentials.env"),
      "TOKEN=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
      "utf8",
    );
    writeFileSync(join(repo, "change.txt"), "implementation\n", "utf8");

    expect(checkBuilderWorkflowChangesStageable(repo, agentRunDir)).toBe(
      "OK: 1 mutated path(s) stageable",
    );
    commitBuilderWorkflowChanges(repo, agentRunDir);

    const committed = trackedFiles(repo);
    expect(committed).toContain("change.txt");
    expect(committed).toContain(
      ".kota/runs/run-current/evidence/evidence-manifest.json",
    );
    expect(committed).not.toContain(".kota/runs/run-sibling/steps/build.json");
    expect(committed).not.toContain(".kota/runs/run-sibling/credentials.env");
    expect(committed).not.toContain(
      ".kota/builder-evidence/run-sibling/credentials.env",
    );
  });

  it("rejects linked durable projection ancestors before traversal", () => {
    const repo = initRepo();
    const agentRunDir = join(repo, ".kota", "builder-evidence", "run-linked");
    writeRequiredArtifacts(agentRunDir);
    const externalRunStore = join(repo, "external-run-store");
    mkdirSync(externalRunStore);
    symlinkSync(externalRunStore, join(repo, ".kota", "runs"));

    expect(() =>
      projectAgentRunArtifactsForValidation(agentRunDir, repo),
    ).toThrow(/projection path must be a real directory/);
  });

  it("projects screened Product evidence before task-queue validation", () => {
    const repo = initRepo();
    const runId = "run-product-validation";
    const taskId = "task-product-validation";
    const agentRunDir = join(repo, ".kota", "builder-evidence", runId);
    writeRequiredArtifacts(agentRunDir);
    const artifacts = artifactRoot(agentRunDir);
    writeFileSync(
      join(artifacts, "transcript.txt"),
      "pnpm kota report\nProduct: 1\n",
      "utf8",
    );
    writeManifest(agentRunDir, [{ path: "transcript.txt", kind: "text" }]);

    const taskDir = join(repo, "data", "tasks", "done");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, `${taskId}.md`),
      `---
id: ${taskId}
title: Ship the operator CLI
status: done
priority: p1
area: client
task_class: Product
summary: Prove the operator CLI journey with a rendered transcript.
created_at: 2026-07-28T00:00:00.000Z
updated_at: 2026-07-28T00:00:00.000Z
---

## Problem

The operator journey needs runtime proof.

## Desired Outcome

The CLI journey is captured as a transcript.

## Constraints

Only screened durable evidence counts.

## Done When

- The transcript proves the CLI output.

## Source / Intent

The Product completion gate requires operator-visible proof.

## Initiative

Operator client quality.

## Acceptance Evidence

- CLI transcript at \`.kota/runs/${runId}/evidence/artifacts/transcript.txt\`.
`,
      "utf8",
    );
    execFileSync("git", ["add", "data/tasks/done"], { cwd: repo });

    expect(
      validateTaskQueue(repo).findings.some(
        (finding) =>
          finding.code === "done-operator-client-missing-rendered-evidence",
      ),
    ).toBe(true);

    expect(
      projectAgentRunArtifactsForValidation(agentRunDir, repo),
    ).toMatch(/projected and staged/);
    expect(
      validateTaskQueue(repo).findings.some(
        (finding) =>
          finding.code === "done-operator-client-missing-rendered-evidence",
      ),
    ).toBe(false);
    expect(
      execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd: repo,
        encoding: "utf8",
      }),
    ).toContain(
      `.kota/runs/${runId}/evidence/artifacts/transcript.txt`,
    );
  });

});
