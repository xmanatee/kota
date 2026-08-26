import { describe, expect, it } from "vitest";
import {
  agentRunDirWriteScopes,
  resolveAgentRunDir,
} from "./agent-run-dir.js";
import { findWriteScopeViolations } from "./steps/agent-write-scope.js";

describe("resolveAgentRunDir", () => {
  it("isolates ordinary workflow output from sibling runtime state", () => {
    expect(resolveAgentRunDir({
      metadata: { runDir: ".kota/runs/run-1" },
      scopeRoot: "/workspace",
    })).toBe("/workspace/.kota/runs/run-1/agent-output");
  });

  it("preserves an invocation-scoped runtime output directory", () => {
    expect(resolveAgentRunDir({
      metadata: { runDir: ".kota/runs/run-1" },
      scopeRoot: "/workspace",
      runtimeResources: {
        agentRunDir: "/workspace/.kota/builder-evidence/run-1",
      },
    })).toBe("/workspace/.kota/builder-evidence/run-1");
  });

  it("scopes only strict workspace descendants into post-step scope", () => {
    expect(agentRunDirWriteScopes(
      "/workspace",
      "/workspace/.kota/runs/run-1/agent-output",
    )).toEqual([".kota/runs/run-1/agent-output"]);
    expect(agentRunDirWriteScopes(
      "/workspace",
      "/outside/agent-output",
    )).toEqual([]);
  });

  it("excludes only isolated output descendants from post-step violations", () => {
    expect(findWriteScopeViolations(
      [
        ".kota/runs/run-1/agent-output/commit-message.txt",
        ".kota/runs/run-1/metadata.json",
        "data/tasks/ready/a.md",
      ],
      "deny-all",
      [".kota/runs/run-1/agent-output"],
    )).toEqual([
      ".kota/runs/run-1/metadata.json",
      "data/tasks/ready/a.md",
    ]);
  });
});
