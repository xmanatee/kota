import { describe, expect, it } from "vitest";
import {
  MAX_TERMINAL_TEXT_RENDER_CODE_UNITS,
  safeTerminalLineText,
  stripTerminalTextControls,
} from "./safe-terminal-text.js";

describe("safe terminal text", () => {
  it("strips complete and unterminated terminal sequences plus formatting controls", () => {
    expect(stripTerminalTextControls(
      "before\x1b]2;forged\x07after\x1b[31m red\x1b[0m\u202efinal",
    )).toBe("beforeafter redfinal");
    expect(stripTerminalTextControls("before\x1b]unterminated payload")).toBe("before");
    expect(stripTerminalTextControls("before\x9dunterminated payload")).toBe("before");
    expect(safeTerminalLineText("first\n\nsecond\x01")).toBe("first second");
  });

  it.each([
    ["ESC-OSC", "\x1b]"],
    ["C1-OSC", "\x9d"],
  ])("bounds repeated unterminated %s prefixes", (_name, prefix) => {
    const adversarial = `visible${prefix.repeat(MAX_TERMINAL_TEXT_RENDER_CODE_UNITS + 1)}`;

    expect(safeTerminalLineText(adversarial)).toBe("visible…");
  });
});
