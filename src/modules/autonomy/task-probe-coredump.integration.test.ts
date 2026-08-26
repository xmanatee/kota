import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { runProbeIfDeclared } from "./critic-runtime-probe.js";

const POST_EXEC_ABORT_STARTED = "KOTA_RUNTIME_PROBE_PACKAGE_ABORT_STARTED";

function runGit(workspaceRoot: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

describe("Runtime Probe coredump containment", () => {
  it.runIf(process.platform === "linux")(
    "fails closed for a host pipe handler or contains a live post-exec abort",
    async () => {
      const parent = join(
        tmpdir(),
        `kota-probe-coredump-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const workspaceRoot = join(parent, "project");
      const taskName = "task-package-abort.md";
      const readyTask = join(workspaceRoot, "data/tasks/ready", taskName);
      const doingTask = join(workspaceRoot, "data/tasks/doing", taskName);
      const runDir = join(workspaceRoot, ".kota/runs/test-run");
      const packageLaunchMarker = join(workspaceRoot, "package-abort-ran.txt");
      const taskContent = [
        "---",
        "title: Post-exec abort probe",
        "---",
        "## Runtime Probe",
        "command: pnpm run probe:abort",
        "timeoutMs: 5000",
      ].join("\n");
      mkdirSync(dirname(readyTask), { recursive: true });
      mkdirSync(runDir, { recursive: true });
      writeFileSync(readyTask, taskContent);
      runGit(workspaceRoot, ["init"]);
      runGit(workspaceRoot, ["config", "user.email", "test@example.com"]);
      runGit(workspaceRoot, ["config", "user.name", "Test User"]);
      runGit(workspaceRoot, ["add", "data/tasks/ready"]);
      runGit(workspaceRoot, ["commit", "-m", "seed trusted abort task"]);
      mkdirSync(dirname(doingTask), { recursive: true });
      renameSync(readyTask, doingTask);
      const abortProgram = [
        'const fs = require("node:fs")',
        `fs.writeFileSync(${JSON.stringify(packageLaunchMarker)}, "ran")`,
        `console.log(${JSON.stringify(POST_EXEC_ABORT_STARTED)})`,
        "process.abort()",
      ].join("; ");
      writeFileSync(
        join(workspaceRoot, "package.json"),
        JSON.stringify({
          name: "post-exec-abort-probe",
          version: "0.0.0",
          scripts: {
            "probe:abort": `node -e ${JSON.stringify(abortProgram)}`,
          },
        }),
      );

      try {
        const corePattern = readFileSync(
          "/proc/sys/kernel/core_pattern",
          "utf8",
        ).trim();
        const result = await runProbeIfDeclared(
          taskContent,
          doingTask,
          workspaceRoot,
          runDir,
          createWorkflowCommandRunner({ cwd: workspaceRoot }),
        );

        expect(result).not.toBeNull();
        expect(existsSync(packageLaunchMarker)).toBe(false);
        if (corePattern.startsWith("|")) {
          expect(result).toMatchObject({
            verdict: "fail",
            execution: "not-executed",
            isolation: { status: "unavailable" },
          });
          expect(result?.output).toContain("host pipe handler");
          expect(result?.output).not.toContain(POST_EXEC_ABORT_STARTED);
        } else if (result?.execution === "os-contained-command") {
          expect(result.verdict).toBe("fail");
          expect(result.output).toContain(POST_EXEC_ABORT_STARTED);
          if (result.isolation?.status !== "enforced") {
            throw new Error("executed probe did not record enforced isolation");
          }
          expect(result.isolation.evidence).toContain(
            "core_pattern verified non-piped",
          );
        } else {
          expect(result).toMatchObject({
            verdict: "fail",
            execution: "not-executed",
            isolation: { status: "unavailable" },
          });
        }
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});
