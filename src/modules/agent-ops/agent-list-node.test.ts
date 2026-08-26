import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildAgentInspectEntries, buildAgentListNode } from "./index.js";

const ROWS = [
  {
    name: "builder",
    source: "autonomy",
    moduleSource: "bundled" as const,
    sourcePath: "src/modules/autonomy",
    sourcePaths: [
      "src/modules/autonomy",
      "src/modules/autonomy/workflows/builder/prompt.md",
    ],
    role: "Implements one normalized task end-to-end",
    model: "claude-opus-4-7",
    promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
    writeScope: [],
    resolvedSkills: [],
    toolPolicy: { posture: "inherits-session" as const },
    workflows: [],
    workflowUsages: [],
    channels: [],
    setupRequirements: [],
  },
  {
    name: "critic",
    source: "autonomy",
    moduleSource: "bundled" as const,
    sourcePath: "src/modules/autonomy",
    sourcePaths: [
      "src/modules/autonomy",
      "src/modules/autonomy/workflows/builder/critic-prompt.md",
    ],
    role: "Judge the diff and runtime artifacts of a builder run",
    model: "claude-opus-4-7",
    promptPath: "src/modules/autonomy/workflows/builder/critic-prompt.md",
    writeScope: [],
    resolvedSkills: [],
    toolPolicy: { posture: "inherits-session" as const },
    workflows: [],
    workflowUsages: [],
    channels: [],
    setupRequirements: [],
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

  it("builds inspect entries for source paths, policy, module links, and setup readiness", () => {
    const entries = buildAgentInspectEntries({
      ...ROWS[0],
      skills: ["tool-cache"],
      resolvedSkills: [
        {
          name: "tool-cache",
          source: "tool-cache",
          promptPath: "src/modules/tool-cache/tool-cache.md",
        },
      ],
      toolPolicy: { posture: "allow-list", allowed: ["Read"] },
      workflows: ["builder"],
      workflowUsages: [
        {
          workflow: "builder",
          stepId: "build",
          harness: "codex",
          autonomyMode: "autonomous",
          effort: "xhigh",
        },
      ],
      channels: ["telegram"],
      setupRequirements: [
        {
          id: "github-oauth",
          kind: "oauth",
          required: true,
          sensitivity: "oauth",
          state: "missing",
          reason: "secret_missing",
          message: "GitHub OAuth is not configured.",
        },
      ],
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Source Files" }),
        expect.objectContaining({
          label: "Skills",
          value: "tool-cache (src/modules/tool-cache/tool-cache.md)",
        }),
        expect.objectContaining({ label: "Tool Policy", value: "allow-list" }),
        expect.objectContaining({ label: "Workflows", value: "builder" }),
        expect.objectContaining({
          label: "Workflow Steps",
          value: "builder.build (harness=codex, autonomy=autonomous, effort=xhigh)",
        }),
        expect.objectContaining({ label: "Channels", value: "telegram" }),
        expect.objectContaining({
          label: "Setup",
          value: "github-oauth missing (required): GitHub OAuth is not configured.",
        }),
      ]),
    );
  });
});
