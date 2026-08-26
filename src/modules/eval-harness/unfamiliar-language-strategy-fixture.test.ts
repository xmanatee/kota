import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  isSingleWorkflowFixtureSpec,
  loadFixture,
} from "./fixture.js";
import { fixtureScoringContext } from "./fixture-scoring-context.js";
import { evaluatePredicate } from "./predicates.js";
import { TEST_EXECUTION_PROFILE } from "./runner-test-profiles.js";
import { createFakeExecutableVerifierSandbox } from "./subprocess-executor-test-helpers.js";

const FIXTURE_ID = "builder-unfamiliar-language-strategy-construction";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");
const RUN_ID = "fixture-builder-run";
const REQUIRED_RUN_ARTIFACTS = [
  "success-criteria.txt",
  "success-criteria-verified.txt",
  "commit-message.txt",
] as const;
const TEST_VERIFIER = createFakeExecutableVerifierSandbox();

afterAll(TEST_VERIFIER.cleanup);

function git(workingDir: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd: workingDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function expectGitOk(workingDir: string, args: string[]): void {
  const result = git(workingDir, args);
  expect(
    result.status,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).toBe(0);
}

describe("unfamiliar-language strategy fixture", () => {
  it("keeps the serial builder evidence stageable without widening solution scope", async () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    const workingDir = mkdtempSync(join(tmpdir(), "kota-spool-fixture-"));
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      expectGitOk(workingDir, ["init", "-q"]);
      expectGitOk(workingDir, [
        "config",
        "user.email",
        "kota@example.invalid",
      ]);
      expectGitOk(workingDir, ["config", "user.name", "KOTA"]);
      expectGitOk(workingDir, ["add", "-A"]);
      expectGitOk(workingDir, ["commit", "-qm", "initial"]);

      const runDir = join(workingDir, ".kota", "runs", RUN_ID);
      mkdirSync(runDir, { recursive: true });
      for (const name of REQUIRED_RUN_ARTIFACTS) {
        const relativePath = `.kota/runs/${RUN_ID}/${name}`;
        writeFileSync(join(runDir, name), `${name}\n`, "utf8");
        expect(git(workingDir, ["check-ignore", "-q", relativePath]).status).toBe(
          1,
        );
        expectGitOk(workingDir, ["add", "--dry-run", "-A", "--", relativePath]);
      }

      const runtimeNoise = `.kota/runs/${RUN_ID}/metadata.json`;
      writeFileSync(join(runDir, "metadata.json"), "{}\n", "utf8");
      expect(git(workingDir, ["check-ignore", "-q", runtimeNoise]).status).toBe(
        0,
      );

      expectGitOk(workingDir, ["add", "-A"]);
      if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
        throw new Error("Fixture must remain a single-workflow fixture.");
      }
      const changedPathPredicate = fixture.spec.predicates.find(
        (predicate) => predicate.kind === "git-changes-within",
      );
      expect(changedPathPredicate?.kind).toBe("git-changes-within");
      if (changedPathPredicate?.kind !== "git-changes-within") {
        throw new Error("Fixture is missing its git-changes-within predicate.");
      }
      const result = await evaluatePredicate(
        workingDir,
        changedPathPredicate,
        fixtureScoringContext({
          capabilities: {
            executableVerifierSandbox: TEST_VERIFIER.sandbox,
          },
          fixture,
          executionProfile: TEST_EXECUTION_PROFILE,
        }),
      );
      expect(result).toMatchObject({ passed: true });
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
