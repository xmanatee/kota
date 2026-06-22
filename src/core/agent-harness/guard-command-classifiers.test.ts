import { describe, expect, it } from "vitest";
import {
  classifyWorkflowShellTeardownCommand,
  isGitCommitCommand,
  isPackageBootstrapCommand,
} from "./guards.js";

describe("isGitCommitCommand", () => {
  it("detects direct `git commit` variants", () => {
    expect(isGitCommitCommand("git commit")).toBe(true);
    expect(isGitCommitCommand("git commit -m 'msg'")).toBe(true);
    expect(isGitCommitCommand('git commit -m "msg"')).toBe(true);
    expect(isGitCommitCommand("git commit --amend")).toBe(true);
    expect(isGitCommitCommand("git commit -a -m msg")).toBe(true);
    expect(isGitCommitCommand("git commit --no-verify -m msg")).toBe(true);
  });

  it("detects `git commit` after shell separators", () => {
    expect(isGitCommitCommand("git add -A && git commit -m msg")).toBe(true);
    expect(isGitCommitCommand("cd foo; git commit")).toBe(true);
    expect(isGitCommitCommand("true | git commit")).toBe(true);
    expect(isGitCommitCommand("(git commit -m msg)")).toBe(true);
  });

  it("detects `git -C <path> commit` plumbing variants", () => {
    expect(isGitCommitCommand("git -C /tmp/project commit")).toBe(true);
    expect(isGitCommitCommand("git -C . commit -m msg")).toBe(true);
  });

  it("ignores commands that are not git commit", () => {
    expect(isGitCommitCommand("git status")).toBe(false);
    expect(isGitCommitCommand("git log --oneline")).toBe(false);
    expect(isGitCommitCommand("git push origin main")).toBe(false);
    expect(isGitCommitCommand("git add -A")).toBe(false);
    expect(isGitCommitCommand("git diff --staged")).toBe(false);
    expect(isGitCommitCommand("git rev-parse HEAD")).toBe(false);
  });

  it("does not match tokens that merely contain `commit`", () => {
    expect(isGitCommitCommand("git log --grep=commit")).toBe(false);
    expect(isGitCommitCommand("echo my-commit")).toBe(false);
    expect(isGitCommitCommand("git show commit-msg")).toBe(false);
    expect(isGitCommitCommand("git push origin mycommit")).toBe(false);
  });

  it("handles whitespace normalization and empty commands", () => {
    expect(isGitCommitCommand("  ")).toBe(false);
    expect(isGitCommitCommand("")).toBe(false);
    expect(isGitCommitCommand("git  commit")).toBe(true);
    expect(isGitCommitCommand("git commit\\\n -m msg")).toBe(true);
  });
});

describe("classifyWorkflowShellTeardownCommand", () => {
  it("detects destructive Git local-work teardown commands", () => {
    expect(classifyWorkflowShellTeardownCommand("git reset --hard HEAD")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git -C /tmp/project reset --hard")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git checkout -- .")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git checkout -- src")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git restore .")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git restore -- src")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git clean -fd")).toBe("local-work");
    expect(classifyWorkflowShellTeardownCommand("git clean -d -f")).toBe("local-work");
  });

  it("detects direct and simply chained infrastructure destroy commands", () => {
    expect(classifyWorkflowShellTeardownCommand("terraform destroy")).toBe("infrastructure");
    expect(classifyWorkflowShellTeardownCommand("terraform apply -destroy")).toBe("infrastructure");
    expect(classifyWorkflowShellTeardownCommand("terraform apply -auto-approve -destroy")).toBe("infrastructure");
    expect(classifyWorkflowShellTeardownCommand("pnpm test && pulumi destroy")).toBe("infrastructure");
    expect(classifyWorkflowShellTeardownCommand("cd infra; cdk destroy")).toBe("infrastructure");
  });

  it("ignores benign Git and ordinary workflow commands", () => {
    expect(classifyWorkflowShellTeardownCommand("git reset --mixed HEAD")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("git checkout feature-branch")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("git restore --help")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("git clean -f")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("git add -A")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("git diff --staged")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("terraform apply")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("terraform apply -destroy=false")).toBeNull();
    expect(classifyWorkflowShellTeardownCommand("pnpm test")).toBeNull();
  });
});

describe("isPackageBootstrapCommand", () => {
  it("detects package bootstrap and install commands", () => {
    expect(isPackageBootstrapCommand("npm install -g pnpm")).toBe(true);
    expect(isPackageBootstrapCommand("npm i")).toBe(true);
    expect(isPackageBootstrapCommand("pnpm install")).toBe(true);
    expect(isPackageBootstrapCommand("yarn add vitest")).toBe(true);
    expect(isPackageBootstrapCommand("corepack enable")).toBe(true);
  });

  it("ignores package-manager commands that do not bootstrap dependencies", () => {
    expect(isPackageBootstrapCommand("pnpm run build")).toBe(false);
    expect(isPackageBootstrapCommand("npm test")).toBe(false);
    expect(isPackageBootstrapCommand("node script.js")).toBe(false);
  });
});
