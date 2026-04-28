import { describe, expect, it } from "vitest";
import {
  ANSWER_CONVERSATIONAL_BLOCK,
  buildAnswerDynamicStateProvider,
} from "./system-prompt.js";

describe("answer system-prompt contributor", () => {
  it("emits the conversational-pattern block when `answer` is in the active tool set", () => {
    const provider = buildAnswerDynamicStateProvider();
    const out = provider({ activeTools: new Set(["answer", "recall"]) });
    expect(out).toBe(ANSWER_CONVERSATIONAL_BLOCK);
  });

  it("emits nothing when `answer` is excluded from the active tool set", () => {
    const provider = buildAnswerDynamicStateProvider();
    const out = provider({ activeTools: new Set(["recall", "capture"]) });
    expect(out).toBe("");
  });

  it("names the tool and a conversational trigger", () => {
    expect(ANSWER_CONVERSATIONAL_BLOCK).toContain("answer");
    expect(ANSWER_CONVERSATIONAL_BLOCK.toLowerCase()).toMatch(
      /cited|synthesi[sz]e|prefer/,
    );
  });
});
