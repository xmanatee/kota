import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { runWorkspace } from "./workspace.js";
import { COMPOSITION_WORKSPACES_ARTIFACT } from "./workspace-snapshot.js";
import { clearAllWorkspaces } from "./workspace-store.js";

type WorkspaceArtifactForTest = {
  schemaVersion: number;
  artifactKind: string;
  diagnostics: { truncatedValues: number };
  scope: {
    kind?: string;
    runId?: string;
    workflowName?: string;
  };
  recovery?: {
    status?: string;
    artifactPath?: string;
    reason?: string;
  };
  workspaces: Array<{
    entries: Array<{
      key?: string;
      value?: string;
      author?: string;
      valueTruncated?: boolean;
      source?: {
        kind?: string;
        runId?: string;
        stepId?: string;
        toolUseId?: string;
      };
    }>;
  }>;
  operations: Array<{
    action: string;
    status?: string;
    workspace?: string;
  }>;
};

let scopeRoot: string;

beforeEach(() => {
  scopeRoot = mkdtempSync(join(tmpdir(), "kota-composition-workspace-"));
});

afterEach(() => {
  clearAllWorkspaces();
  rmSync(scopeRoot, { recursive: true, force: true });
});

function workflowContext(runId: string, toolUseId: string): ToolRunnerContext {
  return {
    cwd: scopeRoot,
    sessionId: "session-1",
    toolUseId,
    workflow: {
      workflowName: "builder",
      runId,
      stepId: "build",
      spanId: `${runId}:build`,
      scopeId: "scope-1",
    },
  };
}

function artifactPath(runId: string): string {
  return join(scopeRoot, ".kota", "runs", runId, COMPOSITION_WORKSPACES_ARTIFACT);
}

function readArtifact(runId: string): WorkspaceArtifactForTest {
  return JSON.parse(readFileSync(artifactPath(runId), "utf-8")) as WorkspaceArtifactForTest;
}

describe("workspace workflow artifacts", () => {
  it("writes a bounded run snapshot when a workflow-scoped workspace is used", async () => {
    const runId = "run-artifact";
    const context = workflowContext(runId, "tool-write");
    const longValue = "x".repeat(4_500);

    await runWorkspace({
      action: "write",
      workspace: "coordination",
      key: "summary",
      value: longValue,
      author: "builder",
    }, context);

    expect(existsSync(artifactPath(runId))).toBe(true);
    const artifact = readArtifact(runId);
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      artifactKind: "composition-workspaces",
      scope: {
        kind: "workflow",
        runId,
        workflowName: "builder",
      },
    });
    expect(artifact.diagnostics.truncatedValues).toBeGreaterThan(0);
    expect(JSON.stringify(artifact)).not.toContain(longValue);
    expect(artifact.workspaces[0].entries[0]).toMatchObject({
      key: "summary",
      author: "builder",
      valueTruncated: true,
      source: {
        kind: "workflow",
        runId,
        stepId: "build",
        toolUseId: "tool-write",
      },
    });
    expect(artifact.operations.map((operation) => operation.action)).toEqual([
      "create",
      "write",
    ]);
  });

  it("does not write a run artifact for no-context workspace use", async () => {
    await runWorkspace({
      action: "write",
      workspace: "scratch",
      key: "k",
      value: "v",
    });

    expect(existsSync(join(scopeRoot, ".kota"))).toBe(false);
  });

  it("restores workflow workspace state from the current run snapshot", async () => {
    const runId = "run-restore";
    const context = workflowContext(runId, "tool-write");
    await runWorkspace({
      action: "write",
      workspace: "coordination",
      key: "summary",
      value: "restore me",
      author: "builder",
    }, context);

    clearAllWorkspaces();
    const read = await runWorkspace({
      action: "read",
      workspace: "coordination",
      key: "summary",
    }, workflowContext(runId, "tool-read"));

    expect(read.is_error).toBeUndefined();
    expect(read.content).toContain("restore me");
    const artifact = readArtifact(runId);
    expect(artifact.recovery).toMatchObject({
      status: "restored",
      artifactPath: `.kota/runs/${runId}/${COMPOSITION_WORKSPACES_ARTIFACT}`,
    });
    expect(artifact.operations.map((operation) => operation.action)).toContain("read");
  });

  it("restores bounded truncated snapshots without replacing them with unavailable recovery", async () => {
    const runId = "run-truncated-restore";
    const longValue = "x".repeat(4_500);
    await runWorkspace({
      action: "write",
      workspace: "coordination",
      key: "summary",
      value: longValue,
      author: "builder",
    }, workflowContext(runId, "tool-write"));

    const writtenArtifact = readArtifact(runId);
    expect(writtenArtifact.diagnostics.truncatedValues).toBeGreaterThan(0);
    expect(writtenArtifact.workspaces[0].entries[0]).toMatchObject({
      key: "summary",
      valueTruncated: true,
    });
    expect(writtenArtifact.workspaces[0].entries[0].value).toContain("... (truncated)");

    clearAllWorkspaces();
    const read = await runWorkspace({
      action: "read",
      workspace: "coordination",
      key: "summary",
    }, workflowContext(runId, "tool-read"));

    expect(read.is_error).toBeUndefined();
    expect(read.content).toContain("... (truncated)");
    expect(read.content).not.toContain(longValue);
    const afterReadArtifact = readArtifact(runId);
    expect(afterReadArtifact.recovery).toMatchObject({
      status: "restored",
      artifactPath: `.kota/runs/${runId}/${COMPOSITION_WORKSPACES_ARTIFACT}`,
    });
    expect(afterReadArtifact.recovery?.reason).toBeUndefined();
    expect(afterReadArtifact.workspaces[0].entries[0]).toMatchObject({
      key: "summary",
      valueTruncated: true,
    });
    expect(afterReadArtifact.operations.at(-1)).toMatchObject({
      action: "read",
      status: "ok",
      workspace: "coordination",
    });

    clearAllWorkspaces();
    const list = await runWorkspace({
      action: "list",
    }, workflowContext(runId, "tool-list"));

    expect(list.is_error).toBeUndefined();
    expect(list.content).toContain("coordination");
    const afterListArtifact = readArtifact(runId);
    expect(afterListArtifact.recovery).toMatchObject({
      status: "restored",
      artifactPath: `.kota/runs/${runId}/${COMPOSITION_WORKSPACES_ARTIFACT}`,
    });
    expect(afterListArtifact.recovery?.reason).toBeUndefined();
    expect(afterListArtifact.operations.at(-1)).toMatchObject({
      action: "list",
      status: "ok",
    });
  });

  it("writes an unavailable recovery diagnostic for a missing restarted scope", async () => {
    const runId = "run-missing";
    const read = await runWorkspace({
      action: "read",
      workspace: "missing",
    }, workflowContext(runId, "tool-read"));

    expect(read.content).toContain("empty");
    const artifact = readArtifact(runId);
    expect(artifact.recovery).toMatchObject({
      status: "unavailable",
      reason:
        "no prior composition workspace snapshot artifact was available for this workflow scope",
    });
    expect(artifact.operations.at(-1)).toMatchObject({
      action: "read-all",
      status: "missing",
      workspace: "missing",
    });
  });
});
