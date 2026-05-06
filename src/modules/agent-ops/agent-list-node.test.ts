import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildAgentListNode } from "./index.js";

const ROWS = [
  {
    name: "builder",
    source: "autonomy",
    role: "Implements one normalized task end-to-end",
    model: "claude-opus-4-7",
    promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
    writeScope: [],
  },
  {
    name: "critic",
    source: "autonomy",
    role: "Judge the diff and runtime artifacts of a builder run",
    model: "claude-opus-4-7",
    promptPath: "src/modules/autonomy/workflows/builder/critic-prompt.md",
    writeScope: [],
  },
];

describe("buildAgentListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders the agents table in ${name} theme`, () => {
      const out = renderToString(
        buildAgentListNode(ROWS),
        renderContext({ theme, width: 140 }),
      );
      expect(out).toContain("builder");
      expect(out).toContain("critic");
      expect(out).toContain("Model");
    });
  }

  it("compresses cleanly under a narrow terminal width", () => {
    const out = renderToString(
      buildAgentListNode(ROWS),
      renderContext({ theme: NO_COLOR_THEME, width: 60 }),
    );
    for (const raw of out.split("\n")) {
      expect(raw.length).toBeLessThanOrEqual(60);
    }
  });
});
