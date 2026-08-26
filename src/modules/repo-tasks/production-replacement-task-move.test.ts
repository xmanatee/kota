import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  linkReplacementFixtureDependencies,
  normalizedReplacementTask,
  REPLACEMENT_EVIDENCE_PATH,
  REPLACEMENT_TASK_ID,
  REPLACEMENT_TEST_PATHS,
  replacementArtifact,
  replacementDeclaration,
  writeReplacementProofFixture,
  writeSyntheticReplacementProofFixture,
} from "./production-replacement-proof.test-helpers.js";
import { moveTaskById, REPO_TASK_STATES } from "./repo-tasks-domain.js";
import { validateTaskQueue } from "./task-queue-validation.js";

vi.mock("#core/agent-harness/task-probe-sandbox.js", () => ({
  resolveContainedWorkspaceSandbox: () => ({
    status: "available",
    kind: "linux-bubblewrap",
    processBoundary: "pid-namespace",
    command: "/usr/bin/env",
    prefixArgs: [],
    probeExecutable: "pnpm",
    evidence: "focused production replacement fixture runner",
  }),
}));

describe("production replacement task transitions", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function project(): string {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-replacement-proof-"));
    projectDirs.push(projectDir);
    return projectDir;
  }

  it("blocks the canonical task mover until the production proof is complete", () => {
    const projectDir = project();
    writeFileSync(
      join(projectDir, ".gitignore"),
      ".kota/\nnode_modules/\ndeclared-production-tests-ran\npackage-script-ran\n",
    );
    linkReplacementFixtureDependencies(projectDir);
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node -e \"require('node:fs').writeFileSync('package-script-ran', 'yes'); process.exit(1)\"",
        },
      }),
    );
    const doingDir = join(projectDir, "data", "tasks", "doing");
    mkdirSync(doingDir, { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "done"), { recursive: true });
    const doingPath = join(doingDir, `${REPLACEMENT_TASK_ID}.md`);
    writeFileSync(doingPath, normalizedReplacementTask("doing", replacementDeclaration()));
    execFileSync("git", ["init", "-q"], { cwd: projectDir });
    execFileSync("git", ["add", ".gitignore", "package.json", "data"], { cwd: projectDir });
    execFileSync("git", ["-c", "user.name=KOTA Test", "-c", "user.email=kota@example.invalid", "commit", "-q", "-m", "fixture"], { cwd: projectDir });

    expect(() => moveTaskById(projectDir, REPLACEMENT_TASK_ID, "done")).toThrow(
      /production replacement proof is incomplete/,
    );
    expect(existsSync(doingPath)).toBe(true);
    writeReplacementProofFixture(projectDir);
    const artifactWithUnboundClaim = replacementArtifact({
      ingressObservations: replacementArtifact().ingressObservations.map(
        (observation, index) => index === 0
          ? {
            ...observation,
            test: { ...observation.test, name: "an assertion that never executed" },
          }
          : observation,
      ),
    });
    writeFileSync(
      join(projectDir, REPLACEMENT_EVIDENCE_PATH),
      JSON.stringify(artifactWithUnboundClaim),
    );
    expect(() => moveTaskById(projectDir, REPLACEMENT_TASK_ID, "done")).toThrow(
      /not bound to one passing assertion/,
    );
    expect(existsSync(doingPath)).toBe(true);
    writeReplacementProofFixture(projectDir);
    writeFileSync(
      join(projectDir, REPLACEMENT_TEST_PATHS[0]),
      "import { it } from 'vitest';\nit('fails', () => { throw new Error('production behavior failed'); });\n",
    );
    expect(() => moveTaskById(projectDir, REPLACEMENT_TASK_ID, "done")).toThrow(
      /declared production tests failed/,
    );
    expect(existsSync(doingPath)).toBe(true);
    writeSyntheticReplacementProofFixture(projectDir);
    expect(() => moveTaskById(projectDir, REPLACEMENT_TASK_ID, "done")).toThrow(
      /did not exercise declared production entrypoint.*assertion-scoped runtime coverage/,
    );
    expect(existsSync(doingPath)).toBe(true);
    writeReplacementProofFixture(projectDir);
    expect(moveTaskById(projectDir, REPLACEMENT_TASK_ID, "done")).toMatchObject({
      fromState: "doing",
      toState: "done",
    });
    const donePath = join(projectDir, "data", "tasks", "done", `${REPLACEMENT_TASK_ID}.md`);
    expect(readFileSync(donePath, "utf-8")).toMatch(/^status: done$/m);
    expect(readFileSync(join(projectDir, "declared-production-tests-ran"), "utf-8")).toBe("yes");
    expect(existsSync(join(projectDir, "package-script-ran"))).toBe(false);
  });

  it("makes the normalized queue validator enforce the declaration and evidence", () => {
    const projectDir = project();
    mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
    for (const state of REPO_TASK_STATES) {
      const stateDir = join(projectDir, "data", "tasks", state);
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "AGENTS.md"), `# ${state}\n`);
    }
    const taskPath = join(projectDir, "data", "tasks", "done", `${REPLACEMENT_TASK_ID}.md`);
    writeFileSync(taskPath, normalizedReplacementTask("done", replacementDeclaration()));
    writeReplacementProofFixture(projectDir);
    execFileSync("git", ["init", "-q"], { cwd: projectDir });
    execFileSync("git", ["add", ".gitignore", "data", "src"], { cwd: projectDir });
    execFileSync("git", ["add", "-f", REPLACEMENT_EVIDENCE_PATH], { cwd: projectDir });
    execFileSync("git", ["-c", "user.name=KOTA Test", "-c", "user.email=kota@example.invalid", "commit", "-q", "-m", "fixture"], { cwd: projectDir });

    expect(validateTaskQueue(projectDir).findings.filter((finding) =>
      finding.code.includes("production-replacement")
    )).toEqual([]);
    writeFileSync(join(projectDir, REPLACEMENT_EVIDENCE_PATH), "{}");
    expect(validateTaskQueue(projectDir).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "done-production-replacement-proof-incomplete" }),
    ]));
    writeFileSync(
      taskPath,
      normalizedReplacementTask(
        "done",
        "## Production Replacement Proof\n\noldBoundary: only",
      ),
    );
    expect(validateTaskQueue(projectDir).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "task-production-replacement-contract-invalid" }),
    ]));
  });
});
