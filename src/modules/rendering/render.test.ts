import { describe, expect, test } from "vitest";
import {
  agentMessage,
  blank,
  diff,
  heading,
  kvBlock,
  line,
  list,
  panel,
  plain,
  sectionRule,
  separator,
  span,
  stack,
  statusBanner,
  toolCall,
} from "./primitives.js";
import { render, renderContext } from "./render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "./theme.js";

const plainCtx = renderContext({ theme: NO_COLOR_THEME, width: 60 });
const ansiCtx = renderContext({ theme: DEFAULT_THEME, width: 60 });

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
