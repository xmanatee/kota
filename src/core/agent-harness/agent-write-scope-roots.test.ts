import { describe, expect, it } from "vitest";
import { resolveAgentFilesystemWriteRoots } from "./agent-write-scope-roots.js";

describe("resolveAgentFilesystemWriteRoots", () => {
  it("adds isolated agent output without exposing sibling workflow state", () => {
    expect(resolveAgentFilesystemWriteRoots(
      "/workspace",
      ["data/tasks/"],
      "/workspace/.kota/runs/run-1/agent-output",
    )).toEqual([
      "/workspace/data/tasks",
      "/workspace/.kota/runs/run-1/agent-output",
    ]);
  });

  it("keeps deny-all agents output-capable across worktree boundaries", () => {
    expect(resolveAgentFilesystemWriteRoots(
      "/workspace",
      "deny-all",
      "/workspace/.kota/runs/run-1/agent-output",
    )).toEqual(["/workspace/.kota/runs/run-1/agent-output"]);

    expect(resolveAgentFilesystemWriteRoots(
      "/workspace",
      "deny-all",
      "/outside/agent-output",
    )).toEqual(["/outside/agent-output"]);

    expect(() => resolveAgentFilesystemWriteRoots(
      "/workspace/task",
      "deny-all",
      "/workspace",
    )).toThrow(/must not contain workflow workspace/);
  });
});
