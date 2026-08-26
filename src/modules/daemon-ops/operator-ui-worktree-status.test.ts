import { describe, expect, it } from "vitest";
import { buildStatusUiSurface } from "./operator-ui.js";
import type { UiNode } from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

function isRunSandboxList(node: UiNode): node is Extract<UiNode, { kind: "list" }> {
  return node.kind === "list" && node.title === "Run sandboxes";
}

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "missing" },
    runProjection: {
      available: true,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [],
    },
    ...overrides,
  };
}

describe("Status UI run sandboxes", () => {
  it("renders durable run state and operational evidence as list items", () => {
    const surface = buildStatusUiSurface(status({
      runProjection: {
        available: true,
        databasePath: "/repo/.kota/kota.sqlite",
        runs: [
          {
            runId: "run-ui",
            projectId: "project-repo",
            workflow: "builder",
            state: "needs_attention",
            resources: ["repository:write", "port:41000-41019"],
            processes: [{ processKey: "agent", status: "unknown" }],
            wait: { kind: "operator" },
            lastError: "agent process outcome is unknown",
            sandbox: {
              runId: "run-ui",
              repository: "write",
              rootDir: "/repo/.kota/runtime/run-ui",
              workspaceDir: "/repo/.worktrees/runs/run-ui/workspace",
              tempDir: "/repo/.kota/runtime/run-ui/temp",
              artifactDir: "/repo/.kota/runtime/run-ui/artifacts",
              branch: "kota/run/run-ui",
              baseCommit: "1111111111111111111111111111111111111111",
              workspace: {
                available: true,
                headCommit: "2222222222222222222222222222222222222222",
                dirty: true,
                dirtySummary: "UU README.md",
              },
            },
          },
        ],
      },
    }));
    const runs = surface.nodes.find(isRunSandboxList);

    expect(runs?.items[0]).toMatchObject({
      id: "run-ui",
      title: "needs_attention: builder",
      role: "error",
    });
    expect(runs?.items[0]?.detail).toContain("resources repository:write, port:41000-41019");
    expect(runs?.items[0]?.detail).toContain('processes {"processKey":"agent","status":"unknown"}');
    expect(runs?.items[0]?.detail).toContain("branch kota/run/run-ui");
    expect(runs?.items[0]?.detail).toContain("base 1111111111111111111111111111111111111111");
    expect(runs?.items[0]?.detail).toContain("head 2222222222222222222222222222222222222222");
    expect(runs?.items[0]?.detail).toContain("dirty UU README.md");
    expect(runs?.items[0]?.detail).toContain('wait {"kind":"operator"}');
    expect(runs?.items[0]?.detail).toContain("error agent process outcome is unknown");
  });
});
