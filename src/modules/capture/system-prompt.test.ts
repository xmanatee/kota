import { describe, expect, it } from "vitest";
import {
  buildCaptureDynamicStateProvider,
  CAPTURE_CONVERSATIONAL_BLOCK,
} from "./system-prompt.js";

describe("capture system-prompt contributor", () => {
  it("emits the conversational-pattern block when `capture` is in the active tool set", () => {
    const provider = buildCaptureDynamicStateProvider();
    const out = provider({ activeTools: new Set(["capture", "recall"]) });
    expect(out).toBe(CAPTURE_CONVERSATIONAL_BLOCK);
  });

  it("emits nothing when `capture` is excluded from the active tool set", () => {
    const provider = buildCaptureDynamicStateProvider();
    const out = provider({ activeTools: new Set(["recall", "answer"]) });
    expect(out).toBe("");
  });

  it("names the tool and a conversational trigger", () => {
    expect(CAPTURE_CONVERSATIONAL_BLOCK).toContain("capture");
    expect(CAPTURE_CONVERSATIONAL_BLOCK.toLowerCase()).toMatch(
      /noteworthy|preference|todo|fact|share/,
    );
  });
});
