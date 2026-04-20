import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { composeCanUseTools } from "./compose-can-use-tool.js";

const options = { signal: new AbortController().signal, toolUseID: "tool-1" };

function allow(input: Record<string, unknown>): PermissionResult {
  return { behavior: "allow", updatedInput: input };
}

function deny(message: string): PermissionResult {
  return {
    behavior: "deny",
    message,
    interrupt: true,
    decisionClassification: "user_reject",
  };
}

describe("composeCanUseTools", () => {
  it("allows when every guard allows", async () => {
    const a: CanUseTool = vi.fn(async (_t, input) => allow(input as Record<string, unknown>));
    const b: CanUseTool = vi.fn(async (_t, input) => allow(input as Record<string, unknown>));
    const composed = composeCanUseTools(a, b);
    const result = await composed("Bash", { command: "echo hi" }, options);
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { command: "echo hi" },
    });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("short-circuits on the first deny and does not call later guards", async () => {
    const denying: CanUseTool = vi.fn(async () => deny("nope"));
    const later: CanUseTool = vi.fn(async (_t, input) => allow(input as Record<string, unknown>));
    const composed = composeCanUseTools(denying, later);
    const result = await composed("Bash", { command: "bad" }, options);
    expect(result).toMatchObject({ behavior: "deny", message: "nope" });
    expect(denying).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
  });

  it("threads updatedInput rewrites through later guards", async () => {
    const rewrite: CanUseTool = vi.fn(async () => ({
      behavior: "allow" as const,
      updatedInput: { command: "rewritten" },
    }));
    const observe: CanUseTool = vi.fn(async (_t, input) => allow(input as Record<string, unknown>));
    const composed = composeCanUseTools(rewrite, observe);
    const result = await composed("Bash", { command: "original" }, options);
    expect(result).toEqual({
      behavior: "allow",
      updatedInput: { command: "rewritten" },
    });
    expect(observe).toHaveBeenCalledWith("Bash", { command: "rewritten" }, options);
  });

  it("returns allow with the original input when no guards are supplied", async () => {
    const composed = composeCanUseTools();
    await expect(
      composed("Bash", { command: "noop" }, options),
    ).resolves.toEqual({ behavior: "allow", updatedInput: { command: "noop" } });
  });
});
