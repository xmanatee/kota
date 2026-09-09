import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeIsolatedVerifier } from "./executable-verifier-sandbox.js";
import type { ExecutableVerifier } from "./executable-verifier-types.js";
import { loadFixture } from "./fixture.js";
import { cleanupFixtureWorkingDir, runFixture, type WorkflowExecutor } from "./runner.js";
import { collectFixtureExecutionEvidence } from "./runner-evidence.js";
import { setupFixtureTree, TEST_EXECUTION_PROFILE } from "./runner-test-profiles.js";
import { createFakeExecutableVerifierSandbox } from "./subprocess-executor-test-helpers.js";

// Owner portfolio: eval consumers need raw patches without candidate-configured
// execution. Exercise runFixture with real Git behind the controlled OCI port;
// the sandbox owner's tests cover resource/env propagation and forced cleanup.
describe("post-run Git evidence isolation", () => {
  let tree: ReturnType<typeof setupFixtureTree>;
  let container: ReturnType<typeof createFakeExecutableVerifierSandbox>;
  let workingDir: string | undefined;

  beforeEach(() => {
    tree = setupFixtureTree();
    container = createFakeExecutableVerifierSandbox();
    const scripts = join(tree.fixturesRoot, "mini", "initial", "scripts");
    mkdirSync(scripts);
    writeFileSync(join(scripts, "modified.txt"), "original scorer\n");
    writeFileSync(join(scripts, "deleted.txt"), "deleted scorer\n");
  });
  afterEach(() => {
    if (workingDir) cleanupFixtureWorkingDir(workingDir);
    workingDir = undefined;
    container.cleanup();
    tree.cleanup();
  });

  async function run(predicateContext: WorkflowExecutor["predicateContext"]) {
    return runFixture({
      fixture: loadFixture(tree.fixturesRoot, "mini"),
      executor: {
        predicateContext,
        preflight: () => TEST_EXECUTION_PROFILE,
        execute: async (request) => {
          workingDir = request.workingDir;
          writeFileSync(join(workingDir, "scripts", "modified.txt"), "candidate scorer edit\n");
          unlinkSync(join(workingDir, "scripts", "deleted.txt"));
          writeFileSync(join(workingDir, "seed.txt"), "changed tracked content\n");
          writeFileSync(join(workingDir, "output.txt"), "new file content\n");
          // Exercise shell quoting of candidate filenames as well as Git config.
          writeFileSync(join(workingDir, "odd ' $(touch INJECTED).txt"), "odd filename\n");
          const helper = join(tree.runsRoot, "candidate-helper.sh");
          writeFileSync(helper, `#!/bin/sh\ntouch '${join(tree.runsRoot, "HELPER_EXECUTED")}'\nprintf 'rewritten by helper\\n'\n`, { mode: 0o755 });
          writeFileSync(join(workingDir, ".gitattributes"), "*.txt diff=candidate filter=candidate\n");
          writeFileSync(join(workingDir, "helper-config"), [
            "[diff]", `external = ${JSON.stringify(helper)}`,
            '[diff "candidate"]', `textconv = ${JSON.stringify(helper)}`,
            "[core]", `fsmonitor = ${JSON.stringify(helper)}`, `hooksPath = ${JSON.stringify(tree.runsRoot)}`,
            '[filter "candidate"]', `clean = ${JSON.stringify(helper)}`,
            `smudge = ${JSON.stringify(helper)}`, `process = ${JSON.stringify(helper)}`, "required = true",
          ].join("\n"));
          appendFileSync(join(workingDir, ".git", "config"), '\n[include]\npath = ../helper-config\n');
          return { kind: "completed", durationMs: 1, runArtifactPath: null };
        },
      },
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: tree.runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
  }

  it("retains raw tracked and untracked patches without executing candidate Git helpers", async () => {
    if (container.sandbox.kind !== "oci-container") throw new Error("Expected test container");
    const log = join(tree.runsRoot, "container.jsonl");
    const report = await run({ executableVerifierSandbox: {
      ...container.sandbox,
      cliEnv: { ...container.sandbox.cliEnv, KOTA_FAKE_CONTAINER_LOG: log },
    } });
    const evidence = report.run.executionEvidence!;
    expect(report.run.outcome).toBe("pass");
    expect(evidence.issues.filter((issue) => issue.startsWith("Diff unavailable"))).toEqual([]);
    expect(evidence.changedFiles).toContain("scripts/modified.txt");
    expect(evidence.changedFiles).toContain("scripts/deleted.txt");
    expect(evidence.changedFiles).toContain("seed.txt");
    expect(evidence.changedFiles).toContain("output.txt");
    expect(evidence.changedFiles).toContain("odd ' $(touch INJECTED).txt");
    const patch = readFileSync(join(evidence.artifactDir, "diff.patch"), "utf8");
    expect(patch).toContain("+candidate scorer edit");
    expect(patch).toContain("-original scorer");
    expect(patch).toContain("-deleted scorer");
    expect(patch).toContain("+changed tracked content");
    expect(patch).toContain("+new file content");
    expect(patch).toContain("+odd filename");
    expect(patch).not.toContain("+rewritten by helper");
    expect(existsSync(join(tree.runsRoot, "HELPER_EXECUTED"))).toBe(false);
    expect(existsSync(join(report.workingDir, "INJECTED"))).toBe(false);
    // This fixture has no executable predicates: these launches can only be
    // post-run evidence collection through the configured container backend.
    const invocations = readFileSync(log, "utf8").trim().split("\n");
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) {
      // The controlled port does not implement mounts: assert the production
      // OCI request cannot obscure any candidate path with scorer overlays.
      expect(JSON.parse(line).mounts).toEqual([
        `type=bind,source=${report.workingDir},target=${report.workingDir}`,
      ]);
    }
  });

  it("records unavailable evidence without host fallback when isolation is absent", async () => {
    const report = await run(undefined);
    const evidence = report.run.executionEvidence!;
    expect(evidence.issues).toContainEqual(expect.stringContaining("refusing evaluator-host git execution"));
    expect(evidence.changedFiles).toEqual([]);
    expect(existsSync(join(evidence.artifactDir, "diff.patch"))).toBe(false);
    expect(existsSync(join(tree.runsRoot, "HELPER_EXECUTED"))).toBe(false);
  });

  it.each(["unavailable", "error", "signal", "exit"] as const)("rejects %s verifier results without retaining partial output", async (failure) => {
    const isolated: ExecutableVerifier = (request) => executeIsolatedVerifier({
      ...request,
      context: {
        sandbox: container.sandbox,
        executionProfile: TEST_EXECUTION_PROFILE,
        workspace: { kind: "candidate" },
      },
    });
    const executableVerifier: ExecutableVerifier = async (request) => {
      // Fail while appending an untracked patch, after tracked evidence was
      // collected successfully. Exit 1 alone is valid for this Git operation.
      if (!request.command.includes("'--no-index'")) return isolated(request);
      if (failure === "unavailable") return { started: false, issue: "container unavailable" };
      if (container.sandbox.kind !== "oci-container") throw new Error("Expected test container");
      return {
        started: true,
        isolation: container.sandbox,
        result: {
          status: failure === "exit" ? 2 : 1,
          signal: failure === "signal" ? "SIGKILL" : null,
          ...(failure === "error" && { error: new Error("output exceeded limit") }),
          stdout: "partial output",
          stderr: "",
        },
      };
    };
    const report = await run(undefined);
    const evidence = await collectFixtureExecutionEvidence(report, executableVerifier);
    expect(evidence.issues).toContainEqual(expect.stringContaining("Diff unavailable"));
    expect(evidence.changedFiles).toEqual([]);
    expect(existsSync(join(evidence.artifactDir, "diff.patch"))).toBe(false);
    expect(existsSync(join(tree.runsRoot, "HELPER_EXECUTED"))).toBe(false);
  });
});
