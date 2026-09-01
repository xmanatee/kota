import { describe, expect, it, vi } from "vitest";
import type { RetractProvider } from "./retract-types.js";
import { createRetractToolDef, createRetractToolRunner } from "./tool.js";

describe("retract tool", () => {
  it("declares the destructive effect that requires confirmation", () => {
    expect(createRetractToolDef(() => ({}) as RetractProvider).effect).toMatchObject({
      kind: "destructive",
      scope: "daemon-state",
    });
  });

  it("binds the uniform target/identifier request to the selected agent scope", async () => {
    const retract = vi.fn().mockResolvedValue({
      ok: true,
      target: "memory",
      identifier: "mem-1",
    });
    const run = createRetractToolRunner(() => ({ retract }));

    await expect(
      run(
        { target: "memory", identifier: "mem-1" },
        { scopeId: "scope-b" },
      ),
    ).resolves.toEqual({ content: "Retracted: memory  mem-1" });
    expect(retract).toHaveBeenCalledWith({
      target: "memory",
      identifier: "mem-1",
      scopeId: "scope-b",
    });
  });
});
