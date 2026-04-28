import { describe, expect, it } from "vitest";
import {
  buildRetractDynamicStateProvider,
  RETRACT_CONVERSATIONAL_BLOCK,
} from "./system-prompt.js";

describe("retract system-prompt contributor", () => {
  it("emits the conversational-pattern block when `retract` is in the active tool set", () => {
    const provider = buildRetractDynamicStateProvider();
    const out = provider({ activeTools: new Set(["retract", "capture"]) });
    expect(out).toBe(RETRACT_CONVERSATIONAL_BLOCK);
  });

  it("emits nothing when `retract` is excluded from the active tool set", () => {
    const provider = buildRetractDynamicStateProvider();
    const out = provider({ activeTools: new Set(["capture", "recall"]) });
    expect(out).toBe("");
  });

  it("names the tool and the `explicit contradiction of a prior capture` trigger", () => {
    expect(RETRACT_CONVERSATIONAL_BLOCK).toContain("retract");
    expect(RETRACT_CONVERSATIONAL_BLOCK.toLowerCase()).toMatch(
      /explicitly contradicts/,
    );
    expect(RETRACT_CONVERSATIONAL_BLOCK.toLowerCase()).toContain(
      "prior",
    );
    expect(RETRACT_CONVERSATIONAL_BLOCK.toLowerCase()).toContain(
      "capture",
    );
  });
});
