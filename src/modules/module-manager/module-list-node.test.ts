import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { ModuleListEntry } from "./client.js";
import { buildModuleListNode } from "./index.js";

const MODULES: ModuleListEntry[] = [
  {
    name: "rendering",
    source: "project",
    status: "loaded",
    version: "1.0.0",
    description: "Typed terminal rendering primitives + transport",
    toolCount: 0,
    workflowCount: 0,
    commandCount: 0,
    channelCount: 0,
    skillCount: 0,
    agentCount: 0,
  },
  {
    name: "autonomy",
    source: "project",
    status: "loaded",
    version: "1.0.0",
    description: "Autonomous development workflows and agents",
    toolCount: 12,
    workflowCount: 8,
    commandCount: 4,
    channelCount: 0,
    skillCount: 3,
    agentCount: 5,
  },
];

describe("buildModuleListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders the modules table in ${name} theme`, () => {
      const out = renderToString(
        buildModuleListNode(MODULES),
        renderContext({ theme, width: 140 }),
      );
      expect(out).toContain("rendering");
      expect(out).toContain("autonomy");
      expect(out).toContain("Description");
    });
  }

  it("compresses cleanly under a narrow terminal width", () => {
    const out = renderToString(
      buildModuleListNode(MODULES),
      renderContext({ theme: NO_COLOR_THEME, width: 80 }),
    );
    for (const raw of out.split("\n")) {
      expect(raw.length).toBeLessThanOrEqual(80);
    }
  });
});
