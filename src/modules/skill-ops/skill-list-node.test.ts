import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildSkillListNode } from "./index.js";

const ROWS = [
  {
    name: "audit",
    source: "rendering",
    sourceType: "module" as const,
    status: "resolvable" as const,
    activation: "default" as const,
    description: "Verify rendered surface diffs",
    promptPath: "src/modules/audit/prompt.md",
  },
  {
    name: "phase-2-migration",
    source: "skill-ops",
    sourceType: "imported" as const,
    status: "resolvable" as const,
    activation: "explicit" as const,
    provenance: "https://example.com/phase-2.md",
    resourceSummary: "2 resources; 1 skipped",
    description:
      "Long description that should wrap or truncate cleanly under a narrow terminal width without overflowing the next column",
    promptPath: "src/modules/skill-ops/prompt.md",
  },
];

describe("buildSkillListNode", () => {

    it(`renders the skill table in no-color theme`, () => {
      const out = renderToString(
        buildSkillListNode(ROWS),
        renderContext({ theme: NO_COLOR_THEME, width: 120 }),
      );
      expect(out).toContain("audit");
      expect(out).toContain("Src");
      expect(out).toContain("Use");
      expect(out).toContain("Resources");
      expect(out).toContain("Description");
    });

});
