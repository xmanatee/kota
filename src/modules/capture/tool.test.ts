import { describe, expect, it, vi } from "vitest";
import type { CaptureProvider } from "./capture-types.js";
import { createCaptureToolDef, createCaptureToolRunner } from "./tool.js";

describe("capture tool", () => {
  it("declares a daemon write effect", () => {
    expect(createCaptureToolDef(() => ({}) as CaptureProvider).effect).toMatchObject({
      kind: "write",
      scope: "daemon-state",
    });
  });

  it("binds the typed request to the selected agent scope", async () => {
    const capture = vi.fn().mockResolvedValue({
      ok: true,
      target: "memory",
      id: "mem-1",
    });
    const run = createCaptureToolRunner(() => ({ capture }));

    await expect(
      run(
        { text: "remember", target: "memory" },
        { scopeId: "scope-b" },
      ),
    ).resolves.toEqual({ content: "Captured: memory  mem-1" });
    expect(capture).toHaveBeenCalledWith("remember", {
      target: "memory",
      scopeId: "scope-b",
    });
  });
});
