import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildMemoryListNode } from "./cli.js";

const ROWS = [
  { id: "m1", created: "2026-04-20T10:00:00.000Z", content: "First memory entry" },
  {
    id: "m2",
    created: "2026-04-20T11:00:00.000Z",
    content:
      "A long memory entry that should still wrap or truncate cleanly under a narrow terminal width",
  },
];

describe("buildMemoryListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders id/date/content columns in ${name} theme`, () => {
      const out = renderToString(
        buildMemoryListNode(ROWS),
        renderContext({ theme, width: 120 }),
      );
      expect(out).toContain("m1");
      expect(out).toContain("First memory entry");
      expect(out).toContain("Content");
    });
  }

  it("compresses content cleanly under a narrow terminal width", () => {
    const out = renderToString(
      buildMemoryListNode(ROWS),
      renderContext({ theme: NO_COLOR_THEME, width: 50 }),
    );
    for (const raw of out.split("\n")) {
      expect(raw.length).toBeLessThanOrEqual(50);
    }
  });
});
