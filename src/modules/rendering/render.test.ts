import { describe, expect, test } from "vitest";
import {
  agentMessage,
  blank,
  columns,
  dashboard,
  diff,
  group,
  heading,
  kvBlock,
  line,
  list,
  panel,
  plain,
  progress,
  prose,
  sectionRule,
  separator,
  span,
  spinner,
  stack,
  statusBanner,
  toolCall,
} from "./primitives.js";
import { render, renderContext } from "./render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME, type Theme } from "./theme.js";

const plainCtx = renderContext({ theme: NO_COLOR_THEME, width: 60 });
const ansiCtx = renderContext({ theme: DEFAULT_THEME, width: 60 });

const ALL_THEMES: { name: string; theme: Theme }[] = [
  { name: "default", theme: DEFAULT_THEME },
  { name: "ascii", theme: ASCII_THEME },
  { name: "no-color", theme: NO_COLOR_THEME },
];

describe("pure renderer", () => {
  test("emits line text without ansi in no-color theme", () => {
    expect(render(line(plain("hello")), plainCtx)).toBe("hello");
  });

  test("emits ansi codes in the default theme when spans carry a role", () => {
    const rendered = render(line(span("ok", "success", true)), ansiCtx);
    expect(rendered).toContain("ok");
    expect(rendered).toContain("[0m");
    expect(rendered).not.toBe("ok");
  });

  test("renders a key-value block with aligned values", () => {
    const out = render(
      kvBlock([
        { label: "Daemon", value: "running" },
        { label: "Approvals", value: "2 pending", role: "warn" },
      ]),
      plainCtx,
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Daemon:");
    expect(lines[0]).toContain("running");
    expect(lines[1]).toContain("Approvals:");
    expect(lines[1]).toContain("2 pending");
    const valuePos = lines[0]!.indexOf("running");
    expect(lines[1]!.indexOf("2 pending")).toBe(valuePos);
  });

  test("renders status banner with icon + label + message", () => {
    const out = render(statusBanner("success", "build green"), plainCtx);
    expect(out).toContain("OK");
    expect(out).toContain("build green");
  });

  test("renders ascii status icons under the ascii theme", () => {
    const asciiCtx = renderContext({ theme: ASCII_THEME, width: 40 });
    const out = render(statusBanner("error", "boom"), asciiCtx);
    expect(out).toContain("x ");
    expect(out).toContain("FAIL");
  });

  test("renders a nested stack with blanks and separators", () => {
    const node = stack(
      heading("Section", 1),
      blank(),
      line(plain("body")),
      separator(),
    );
    const out = render(node, plainCtx);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Section");
    expect(lines[1]).toMatch(/^-+$/);
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("body");
    expect(lines[4]).toMatch(/^-+$/);
  });

  test("renders list with nested children indented", () => {
    const out = render(
      list([
        { spans: [plain("first")] },
        {
          spans: [plain("second")],
          children: [line(plain("child"))],
        },
      ]),
      plainCtx,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("- first");
    expect(lines[1]).toBe("- second");
    expect(lines[2]).toBe("  child");
  });

  test("renders panel with a box around body content", () => {
    const out = render(
      panel(line(plain("inside"))),
      renderContext({ theme: NO_COLOR_THEME, width: 20 }),
    );
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^┌─+┐$/);
    expect(lines.at(-1)).toMatch(/^└─+┘$/);
    expect(lines[1]).toContain("inside");
  });

  test("renders panel title inline at the top border", () => {
    const out = render(
      panel(line(plain("body")), { title: "Status" }),
      renderContext({ theme: NO_COLOR_THEME, width: 30 }),
    );
    const [top] = out.split("\n");
    expect(top).toContain("Status");
  });

  test("renders tool call with status icon and args", () => {
    const out = render(toolCall("grep", "success", { summary: "files", args: "pattern" }), plainCtx);
    expect(out).toContain("grep");
    expect(out).toContain("args: pattern");
  });

  test("renders agent message with role header", () => {
    const out = render(agentMessage("assistant", line(plain("hi"))), plainCtx);
    const lines = out.split("\n");
    expect(lines[0]).toContain("[assistant]");
    expect(lines[1]).toContain("hi");
  });

  test("renders diff with plus/minus prefixes preserved", () => {
    const patch = ["@@ -1 +1 @@", "-old", "+new"].join("\n");
    const out = render(diff(patch), plainCtx);
    const lines = out.split("\n");
    expect(lines[0]).toContain("@@");
    expect(lines[1]).toContain("-old");
    expect(lines[2]).toContain("+new");
  });

  test("clamps width to a safe minimum to avoid negative divisions", () => {
    const ctx = renderContext({ theme: NO_COLOR_THEME, width: 2 });
    const out = render(separator(), ctx);
    expect(out.length).toBeGreaterThan(0);
  });

  test("section rule renders label with a width-filling separator tail", () => {
    for (const width of [40, 80, 120, 160]) {
      const ctx = renderContext({ theme: NO_COLOR_THEME, width });
      const out = render(sectionRule("Activity"), ctx);
      expect(out.length).toBe(width);
      expect(out.startsWith("Activity ")).toBe(true);
      expect(out.endsWith("-")).toBe(true);
    }
  });
});

describe("columns primitive", () => {
  const sampleColumns = columns(
    [
      { header: "Workflow", align: "left", role: "tool" },
      { header: "Duration", align: "right" },
      { header: "Run", align: "left", role: "muted" },
    ],
    [
      {
        cells: [
          { spans: [plain("builder")] },
          { spans: [plain("12m 04s")] },
          { spans: [plain("i8tz5a")] },
        ],
      },
      {
        cells: [
          { spans: [plain("dispatcher")] },
          { spans: [plain("3s")] },
          { spans: [plain("ab12cd")] },
        ],
      },
    ],
  );

  for (const { name, theme } of ALL_THEMES) {
    test(`renders header + rows aligned and width-stable in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 60 });
      const out = render(sampleColumns, ctx);
      const lines = out.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("Workflow");
      expect(lines[0]).toContain("Duration");
      expect(lines[0]).toContain("Run");
      expect(lines[1]).toContain("builder");
      expect(lines[1]).toContain("12m 04s");
      expect(lines[2]).toContain("dispatcher");
      const colDuration = lines[1]!.indexOf("12m 04s");
      const colDuration2 = lines[2]!.indexOf("3s");
      expect(colDuration2 + "3s".length).toBeGreaterThan(0);
      expect(colDuration).toBeGreaterThan(0);
    });
  }

  test("compresses to a narrow terminal without overflowing the width", () => {
    const ctx = renderContext({ theme: NO_COLOR_THEME, width: 30 });
    const out = render(sampleColumns, ctx);
    for (const ln of out.split("\n")) {
      expect(ln.length).toBeLessThanOrEqual(30);
    }
  });

  test("right-aligned column pads on the left", () => {
    const ctx = renderContext({ theme: NO_COLOR_THEME, width: 80 });
    const out = render(sampleColumns, ctx);
    const lines = out.split("\n");
    const headerStart = lines[0]!.indexOf("Workflow");
    expect(headerStart).toBe(0);
    const builderRow = lines[1]!;
    expect(builderRow.startsWith("builder")).toBe(true);
  });
});

describe("group primitive", () => {
  for (const { name, theme } of ALL_THEMES) {
    test(`renders label + indented body in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 60 });
      const out = render(
        group("Activity", stack(line(plain("first")), line(plain("second"))), "info"),
        ctx,
      );
      const lines = out.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("Activity");
      expect(lines[1]).toContain("first");
      expect(lines[1]!.startsWith("  ")).toBe(true);
      expect(lines[2]).toContain("second");
      expect(lines[2]!.startsWith("  ")).toBe(true);
    });
  }
});

describe("prose primitive", () => {
  const longParagraph =
    "The owner reads the CLI as visually poor even after Phase 2 migrations land. The vocabulary still lacks aligned columns, role-aware groups, and width-aware prose so this paragraph should wrap cleanly inside the available width without overflowing the terminal.";

  for (const { name, theme } of ALL_THEMES) {
    test(`wraps to ctx.width in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 40 });
      const out = render(prose(longParagraph), ctx);
      const lines = out.split("\n");
      expect(lines.length).toBeGreaterThan(2);
      for (const ln of lines) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching the ESC control char
        const stripped = ln.replace(/\x1b\[[0-9;]*m/g, "");
        expect(stripped.length).toBeLessThanOrEqual(40);
      }
    });
  }

  test("preserves paragraph breaks via blank lines", () => {
    const ctx = renderContext({ theme: NO_COLOR_THEME, width: 40 });
    const out = render(prose("first paragraph here.\n\nsecond paragraph here."), ctx);
    expect(out).toContain("first paragraph here.");
    expect(out.split("\n").some((l) => l === "")).toBe(true);
    expect(out).toContain("second paragraph here.");
  });
});

describe("dashboard primitive", () => {
  const sample = dashboard([
    {
      title: "State",
      role: "info",
      body: kvBlock([
        { label: "Daemon", value: "running" },
        { label: "Sessions", value: "1" },
      ]),
    },
    {
      title: "Activity",
      role: "accent",
      body: list([{ spans: [plain("builder")] }, { spans: [plain("dispatcher")] }]),
    },
  ]);

  for (const { name, theme } of ALL_THEMES) {
    test(`renders sections separated by a blank line in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 50 });
      const out = render(sample, ctx);
      expect(out).toContain("State");
      expect(out).toContain("Activity");
      const lines = out.split("\n");
      const stateIdx = lines.findIndex((l) => l.includes("State"));
      const activityIdx = lines.findIndex((l) => l.includes("Activity"));
      expect(activityIdx).toBeGreaterThan(stateIdx);
      expect(lines[activityIdx - 1]).toBe("");
      expect(lines[activityIdx - 2]).toBe("");
    });
  }
});

describe("spinner primitive (pure render)", () => {
  for (const { name, theme } of ALL_THEMES) {
    test(`emits a static frame for non-tick render in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 60 });
      const out = render(spinner("loading data"), ctx);
      expect(out).toContain("loading data");
    });

    test(`emits a tick-specific frame when tick is provided in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 60 });
      const frame0 = render(spinner("loading", { tick: 0 }), ctx);
      const frame3 = render(spinner("loading", { tick: 3 }), ctx);
      expect(frame0).toContain("loading");
      expect(frame3).toContain("loading");
      expect(frame0).not.toBe(frame3);
    });
  }

  test("emits the success status icon when status is success", () => {
    const ctx = renderContext({ theme: ASCII_THEME, width: 60 });
    const out = render(spinner("done", { status: "success" }), ctx);
    expect(out).toContain("v ");
    expect(out).toContain("done");
  });
});

describe("progress primitive", () => {
  for (const { name, theme } of ALL_THEMES) {
    test(`renders a width-aware bar with counter in ${name} theme`, () => {
      const ctx = renderContext({ theme, width: 40 });
      const out = render(progress("syncing", 3, 10), ctx);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching the ESC control char
      const stripped = out.replace(/\x1b\[[0-9;]*m/g, "");
      expect(stripped).toContain("syncing");
      expect(stripped).toContain("3/10");
      expect(stripped.length).toBeLessThanOrEqual(40);
    });
  }

  test("uses success role when complete", () => {
    const out = render(progress("done", 5, 5), renderContext({ theme: DEFAULT_THEME, width: 40 }));
    expect(out).toContain("[32m");
  });
});
