import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { checkPackageScript } from "./project-package-checks.js";

const tempDirs: string[] = [];

function tempProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-package-check-"));
  tempDirs.push(projectDir);
  return projectDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform === "win32")("checkPackageScript", () => {
  it("runs an argv command through the workflow command context", async () => {
    const projectDir = tempProject();
    writeFileSync(join(projectDir, "package.json"), "{}\n");
    const context = {
      runCommand: createWorkflowCommandRunner({ cwd: projectDir }),
    };

    const output = await checkPackageScript(context, projectDir, {
      command: process.execPath,
      args: ["-e", "process.stdout.write('package-ok')"],
    });

    expect(output).toBe("package-ok");
  });

  it("skips repositories without package project markers", async () => {
    const projectDir = tempProject();
    mkdirSync(join(projectDir, "src"));
    const context = {
      runCommand: createWorkflowCommandRunner({ cwd: projectDir }),
    };

    await expect(
      checkPackageScript(context, projectDir, {
        command: process.execPath,
        args: ["-e", "process.exit(1)"],
      }),
    ).resolves.toBe("OK: no package project present");
  });
});
