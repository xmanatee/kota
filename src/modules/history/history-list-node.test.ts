import { describe, expect, it } from "vitest";
import type { ConversationRecord } from "#core/modules/provider-types.js";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildHistoryListNode } from "./cli-commands.js";

const SAMPLE: ConversationRecord[] = [
  {
    id: "conv-001",
    title: "Sketch the Phase 2 surface migration plan",
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T11:30:00.000Z",
    model: "claude-sonnet-4-6",
    messageCount: 42,
    cwd: "/repo",
  },
  {
    id: "conv-002",
    title: "A long conversation title that should wrap or truncate cleanly under a narrow terminal width to verify the column primitive enforces its maxWidth contract",
    createdAt: "2026-04-21T08:00:00.000Z",
    updatedAt: "2026-04-21T09:15:00.000Z",
    model: "claude-opus-4-7",
    messageCount: 7,
    cwd: "/repo",
  },
];

describe("buildHistoryListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders id/updated/msgs/title columns in ${name} theme at wide width`, () => {
      const out = renderToString(
        buildHistoryListNode(SAMPLE),
        renderContext({ theme, width: 120 }),
      );
      expect(out).toContain("conv-001");
      expect(out).toContain("Sketch the Phase 2 surface migration plan");
      expect(out).toContain("Updated");
    });

    it(`compresses cleanly within a narrow width in ${name} theme`, () => {
      const out = renderToString(
        buildHistoryListNode(SAMPLE),
        renderContext({ theme, width: 60 }),
      );
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
      const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
      for (const raw of out.split("\n")) {
        expect(stripAnsi(raw).length).toBeLessThanOrEqual(60);
      }
    });
  }

  it("declares Title with a maxWidth so long titles do not overflow", () => {
    const node = buildHistoryListNode(SAMPLE);
    const titleSpec = node.columns.find((c) => c.header === "Title")!;
    expect(titleSpec.maxWidth).toBeDefined();
  });
});
