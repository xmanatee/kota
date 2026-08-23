import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  enforceProductionReplacementCompletion,
  verifyProductionReplacementCompletion,
} from "./production-replacement-completion.js";
import {
  normalizedReplacementTask,
  REPLACEMENT_ENTRYPOINT_PATHS,
  REPLACEMENT_EVIDENCE_PATH,
  REPLACEMENT_TASK_ID,
  replacementArtifact,
  replacementDeclaration,
  writeReplacementProofFixture,
} from "./production-replacement-proof.test-helpers.js";
import { getRepoTaskStateTransitionBlocker } from "./repo-tasks-domain.js";

describe("production replacement completion", () => {
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

  function initializeAndTrackProof(projectDir: string): void {
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\nnode_modules/\n");
    execFileSync("git", ["init", "-q"], { cwd: projectDir });
    execFileSync("git", ["add", "src"], { cwd: projectDir });
    execFileSync("git", ["add", "-f", REPLACEMENT_EVIDENCE_PATH], { cwd: projectDir });
  }

  it("accepts completion only when every live and restart ingress used the owner", () => {
    const projectDir = project();
    writeReplacementProofFixture(projectDir);
    initializeAndTrackProof(projectDir);
    const body = replacementDeclaration();
    expect(verifyProductionReplacementCompletion({
      raw: body,
      taskId: REPLACEMENT_TASK_ID,
      projectDir,
    })).toMatchObject({ ok: true });
    expect(getRepoTaskStateTransitionBlocker({
      id: REPLACEMENT_TASK_ID,
      title: "Replace runtime ingress",
      area: "architecture",
      summary: "Use one owner.",
      taskClass: "Platform",
      productionReplacement: true,
      body: normalizedReplacementTask("doing", body),
    }, "done", projectDir)).toBeNull();
  });

  it("fails closed for unbound production provenance, bypassed restore, or absent retired-path proof", () => {
    const projectDir = project();
    writeReplacementProofFixture(projectDir);
    initializeAndTrackProof(projectDir);
    const cases = [
      {
        value: replacementArtifact({
          ingressObservations: replacementArtifact().ingressObservations.map(
            (observation, index) => index === 0
              ? { ...observation, effectObserved: true }
              : observation,
          ),
        }),
        error: "hand-authored pass flags",
      },
      {
        value: replacementArtifact({
          ingressObservations: replacementArtifact().ingressObservations.map(
            (observation, index) =>
              index === 0
                ? {
                  ...observation,
                  test: {
                    ...observation.test,
                    entrypoints: ["src/legacy-runtime.ts"],
                  },
                }
                : observation,
          ),
        }),
        error: "not declared in productionEntrypoints",
      },
      {
        value: replacementArtifact({
          ingressObservations: replacementArtifact().ingressObservations.filter(
            (observation) => observation.kind !== "restart",
          ),
        }),
        error: "every declared live and restart ingress",
      },
      {
        value: replacementArtifact({
          retiredBoundary: {
            check: "legacy ingress is unreachable from live and restored state",
            tests: [],
          },
        }),
        error: "bind at least one production assertion",
      },
    ];
    for (const scenario of cases) {
      writeReplacementProofFixture(projectDir, scenario.value);
      execFileSync("git", ["add", "-f", REPLACEMENT_EVIDENCE_PATH], { cwd: projectDir });
      expect(verifyProductionReplacementCompletion({
        raw: replacementDeclaration(),
        taskId: REPLACEMENT_TASK_ID,
        projectDir,
      })).toEqual({ ok: false, error: expect.stringContaining(scenario.error) });
    }
  });

  it("rejects live and restored behavior regressions inside declared production entrypoints", () => {
    const projectDir = project();
    writeReplacementProofFixture(projectDir);
    initializeAndTrackProof(projectDir);
    writeFileSync(
      join(projectDir, REPLACEMENT_ENTRYPOINT_PATHS[0]),
      `export function exerciseLiveAssembly() {
  return { ownerReceived: ["startup", "event"], retiredReceived: ["legacy"] };
}
`,
    );
    expect(enforceProductionReplacementCompletion({
      raw: replacementDeclaration(),
      taskId: REPLACEMENT_TASK_ID,
      projectDir,
    })).toEqual({
      ok: false,
      error: expect.stringContaining("declared production tests failed"),
    });
    writeReplacementProofFixture(projectDir);
    writeFileSync(
      join(projectDir, REPLACEMENT_ENTRYPOINT_PATHS[1]),
      `export function exerciseRestartAssembly() {
  return {
    restored: [
      { id: "manual", admitted: true },
      { id: "obsolete", admitted: false },
    ],
    obsoleteRestored: true,
  };
}
`,
    );
    expect(enforceProductionReplacementCompletion({
      raw: replacementDeclaration(),
      taskId: REPLACEMENT_TASK_ID,
      projectDir,
    })).toEqual({
      ok: false,
      error: expect.stringContaining("declared production tests failed"),
    });
  });

});
