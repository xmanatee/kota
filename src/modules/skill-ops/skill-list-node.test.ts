import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildSkillListNode } from "./index.js";

const ROWS = [
  {
    name: "audit",
    source: "rendering",
    description: "Verify rendered surface diffs",
    promptPath: "src/modules/audit/prompt.md",
  },
  {
    name: "phase-2-migration",
    source: "skill-ops",
    description:
      "Long description that should wrap or truncate cleanly under a narrow terminal width without overflowing the next column",
    promptPath: "src/modules/skill-ops/prompt.md",
  },
];

describe("buildSkillListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders the skill table in ${name} theme`, () => {
      const out = renderToString(
        buildSkillListNode(ROWS),
        renderContext({ theme, width: 120 }),
      );
      expect(out).toContain("audit");
      expect(out).toContain("Source");
      expect(out).toContain("Description");
    });
  }
});
