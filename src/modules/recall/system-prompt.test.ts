import { describe, expect, it } from "vitest";
import {
  buildRecallDynamicStateProvider,
  RECALL_CONVERSATIONAL_BLOCK,
} from "./system-prompt.js";

describe("recall system-prompt contributor", () => {
  it("emits the conversational-pattern block when `recall` is in the active tool set", () => {
    const provider = buildRecallDynamicStateProvider();
    const out = provider({ activeTools: new Set(["recall", "capture"]) });
    expect(out).toBe(RECALL_CONVERSATIONAL_BLOCK);
  });

  it("emits nothing when `recall` is excluded from the active tool set", () => {
    const provider = buildRecallDynamicStateProvider();
    const out = provider({ activeTools: new Set(["capture", "answer"]) });
    expect(out).toBe("");
  });

  it("names the tool and a conversational trigger", () => {
    expect(RECALL_CONVERSATIONAL_BLOCK).toContain("recall");
    expect(RECALL_CONVERSATIONAL_BLOCK.toLowerCase()).toMatch(
      /before answering|fact|ground/,
    );
  });
});
