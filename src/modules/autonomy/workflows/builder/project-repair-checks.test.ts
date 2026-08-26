import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { checkMobileTypecheck } from "./project-repair-checks.js";

const commandContext: Pick<WorkflowStepContext, "runCommand"> = {
  runCommand: () => Promise.reject(new Error("unexpected command execution")),
};

function git(projectDir: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeProjectFile(projectDir: string, path: string, content: string): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

describe("checkMobileTypecheck", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-mobile-change-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    git(projectDir, "init", "-q", "-b", "main");
    git(projectDir, "config", "user.email", "test@example.com");
    git(projectDir, "config", "user.name", "Test");
    git(projectDir, "config", "commit.gpgsign", "false");
    writeProjectFile(
      projectDir,
      "clients/mobile/package.json",
      '{"scripts":{"typecheck":"tsc --noEmit"}}\n',
    );
    git(projectDir, "add", "clients/mobile/package.json");
    git(projectDir, "commit", "-q", "-m", "seed mobile client");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("allows a clean mobile project when dependencies are absent", async () => {
    await expect(checkMobileTypecheck(commandContext, projectDir)).resolves.toContain(
      "no mobile changes",
    );
  });

  it("detects a new untracked mobile app file", async () => {
    writeProjectFile(
      projectDir,
      "clients/mobile/src/new-screen.tsx",
      "export const NewScreen = () => null;\n",
    );

    await expect(checkMobileTypecheck(commandContext, projectDir)).rejects.toThrow(
      "clients/mobile/src/new-screen.tsx",
    );
  });
});
