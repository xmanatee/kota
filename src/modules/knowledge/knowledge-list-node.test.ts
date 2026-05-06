import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildKnowledgeListNode, buildKnowledgeSearchNode } from "./cli.js";

const ROWS = [
  {
    id: "k1",
    title: "Phase 2 surface migration plan",
    type: "plan",
    status: "active",
    updated: "2026-04-20T10:00:00.000Z",
  },
  {
    id: "k2",
    title:
      "A long entry title that should wrap or truncate cleanly under a narrow terminal width without overflowing the next column",
    type: "note",
    status: "draft",
    updated: "2026-04-21T10:00:00.000Z",
  },
];

describe("buildKnowledgeListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders id/type/status/updated/title columns in ${name} theme`, () => {
      const out = renderToString(
        buildKnowledgeListNode(ROWS),
        renderContext({ theme, width: 140 }),
      );
      expect(out).toContain("k1");
      expect(out).toContain("Phase 2 surface migration plan");
      expect(out).toContain("Status");
    });
  }

  it("fits within a narrow terminal", () => {
    const out = renderToString(
      buildKnowledgeListNode(ROWS),
      renderContext({ theme: NO_COLOR_THEME, width: 60 }),
    );
    for (const raw of out.split("\n")) {
      expect(raw.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("buildKnowledgeSearchNode", () => {
  it("renders id/type/title columns", () => {
    const out = renderToString(
      buildKnowledgeSearchNode(ROWS),
      renderContext({ theme: NO_COLOR_THEME, width: 100 }),
    );
    expect(out).toContain("k1");
    expect(out).toContain("Phase 2 surface migration plan");
  });
});
