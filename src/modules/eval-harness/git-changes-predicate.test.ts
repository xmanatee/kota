import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluatePredicate,
  type PredicateEvaluationContext,
} from "./predicates.js";

function isolatedGitContext(status: () => string): PredicateEvaluationContext {
  return {
    executableVerifier: async ({ command }) => ({
      started: true,
      isolation: {
        kind: "oci-container",
        command: "test-container",
        image: "test:image",
        cliEnv: {},
        evidence: "test isolated git verifier",
      },
      result: {
        signal: null,
        status: 0,
        stderr: "",
        stdout: command.includes(" rev-list ")
          ? "0123456789abcdef0123456789abcdef01234567\n"
          : command.includes(" diff ")
            ? "A\tdata/allowed.txt\n"
            : status(),
      },
    }),
  };
}

describe("git-changes-within predicate", () => {
  let workDir: string;

  function runGit(args: string[]): void {
    const result = spawnSync("git", args, {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(
      result.status,
      `git ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`,
    ).toBe(0);
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-git-predicate-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("fails when committed or working-tree paths leave the allowed set", async () => {
    const context = isolatedGitContext(() =>
      existsSync(join(workDir, "forbidden"))
        ? " M .kota/config.json\n"
        : "?? .kota/runs/run-1/metadata.json\n",
    );
    const predicate = {
      kind: "git-changes-within" as const,
      allowedPaths: ["data/allowed.txt"],
    };

    expect((await evaluatePredicate(workDir, predicate, context)).passed).toBe(true);
    writeFileSync(join(workDir, "forbidden"), "present\n");
    const forbidden = await evaluatePredicate(workDir, predicate, context);
    expect(forbidden.passed).toBe(false);
    expect(forbidden.detail).toContain(".kota/config.json");
  });

  it("does not execute a repository fsmonitor on the evaluator host", async () => {
    runGit(["init", "--quiet", "--initial-branch=main"]);
    runGit(["config", "user.email", "eval-harness@kota.local"]);
    runGit(["config", "user.name", "KOTA Eval Harness"]);
    runGit(["config", "commit.gpgsign", "false"]);
    runGit(["commit", "--allow-empty", "-m", "initial", "--quiet"]);

    const marker = join(workDir, "host-fsmonitor-ran.txt");
    const fsmonitor = join(workDir, "malicious-fsmonitor.mjs");
    writeFileSync(
      fsmonitor,
      `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "unsafe");\nprocess.stdout.write("\\0");\n`,
    );
    chmodSync(fsmonitor, 0o755);
    runGit(["config", "core.fsmonitor", fsmonitor]);

    const hostResult = await evaluatePredicate(workDir, {
      kind: "git-changes-within",
      allowedPaths: [],
    });
    expect(hostResult.passed).toBe(false);
    expect(hostResult.detail).toContain("verified isolated verifier");
    expect(existsSync(marker)).toBe(false);

    const isolatedCommands: string[] = [];
    const context = isolatedGitContext(() => "?? malicious-fsmonitor.mjs\n");
    const verifier = context.executableVerifier;
    if (verifier === undefined) throw new Error("missing test verifier");
    context.executableVerifier = async (request) => {
      isolatedCommands.push(request.command);
      return verifier(request);
    };
    const isolatedResult = await evaluatePredicate(
      workDir,
      {
        kind: "git-changes-within",
        allowedPaths: ["data/allowed.txt", "malicious-fsmonitor.mjs"],
      },
      context,
    );

    expect(isolatedResult.passed).toBe(true);
    expect(isolatedCommands).toHaveLength(3);
    expect(
      isolatedCommands.every((command) =>
        command.includes("-c core.fsmonitor=false"),
      ),
    ).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});
