// biome-ignore-all assist/source/organizeImports: mock support must load before the tested module
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import {
  permissionTestMocks,
  runOptions,
  toolBlock,
} from "./tool-runner-permission-test-support.js";
import { executeToolCalls } from "./tool-runner.js";

const { confirmActionMock, mockExecuteTool, mockGetToolEffect } =
  permissionTestMocks();

describe("agent write-scope tool gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToolEffect.mockReturnValue({
      kind: "write",
      scope: "local-fs",
      idempotent: false,
      openWorld: false,
    });
  });

  it("blocks writes outside the agent-owned filesystem scope", async () => {
    const results = await executeToolCalls(
      [toolBlock("file_write", {
        path: "/tmp/project/.kota/runs/run-1/progress-review-evidence.json",
        content: "forged",
      })],
      runOptions({
        cwd: "/tmp/project",
        agentWriteScope: [".kota/progress-reviewer-agent-output/"],
      }),
    );

    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0].content).toContain("outside the declared write roots");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("allows only the isolated output directory for a deny-all agent", async () => {
    mockExecuteTool.mockResolvedValue({ content: "written" });
    confirmActionMock.mockResolvedValue(true);
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "project",
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: "scope",
            displayName: "Scope",
            parentScopeId: "global",
            directoryRoot: "/tmp/project",
          },
        ],
      },
      scopeId: "scope",
      fragments: [{
        scopeId: "scope",
        reason: "Scope writes stay in task data.",
        writes: { mode: "paths", paths: ["data/tasks"] },
      }],
    });
    const options = runOptions({
      cwd: "/tmp/project",
      agentWriteScope: "deny-all",
      agentOutputDir: "/tmp/project/.kota/runs/run-1/agent-output",
      scopePolicy,
    });

    const allowed = await executeToolCalls(
      [toolBlock("file_write", {
        path: "/tmp/project/.kota/runs/run-1/agent-output/review.json",
        content: "bounded",
      })],
      options,
    );
    expect(allowed[0]).toMatchObject({ content: "written" });
    expect(allowed[0]).not.toHaveProperty("is_error");
    expect(mockExecuteTool).toHaveBeenCalledOnce();

    mockExecuteTool.mockClear();
    const sibling = await executeToolCalls(
      [toolBlock("file_write", {
        path: "/tmp/project/.kota/runs/run-1/metadata.json",
        content: "forged",
      })],
      options,
    );
    expect(sibling[0]).toMatchObject({ is_error: true });
    expect(sibling[0].content).toContain("outside the declared write roots");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("blocks opaque execution when bounded scope cannot prove targets", async () => {
    const results = await executeToolCalls(
      [toolBlock("shell", { command: "printf forged > .kota/runs/evidence.json" })],
      runOptions({
        cwd: "/tmp/project",
        agentWriteScope: [".kota/progress-reviewer-agent-output/"],
      }),
    );

    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0].content).toContain(
      "does not expose a complete filesystem target",
    );
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("preserves destructive confirmation inside the agent output directory", async () => {
    mockGetToolEffect.mockReturnValue({
      kind: "destructive",
      scope: "local-fs",
      idempotent: false,
      openWorld: false,
    });
    confirmActionMock.mockResolvedValue(false);
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: "project",
        scopes: [
          { scopeId: "global", displayName: "Global" },
          {
            scopeId: "scope",
            displayName: "Scope",
            parentScopeId: "global",
            directoryRoot: "/tmp/project",
          },
        ],
      },
      scopeId: "scope",
      fragments: [{
        scopeId: "scope",
        reason: "Scope writes stay in task data.",
        writes: { mode: "paths", paths: ["data/tasks"] },
      }],
    });

    const results = await executeToolCalls(
      [toolBlock("file_write", {
        path: "/tmp/project/.kota/runs/run-1/agent-output/review.json",
        content: "replacement",
      })],
      runOptions({
        cwd: "/tmp/project",
        agentWriteScope: "deny-all",
        agentOutputDir: "/tmp/project/.kota/runs/run-1/agent-output",
        scopePolicy,
      }),
    );

    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0].content).toContain("destructive on local-fs");
    expect(results[0].content).toContain("owner policy resolves this tool effect to confirm");
    expect(confirmActionMock).toHaveBeenCalledWith(
      expect.stringContaining("Allow file_write?"),
    );
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});
