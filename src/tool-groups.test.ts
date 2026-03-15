import { describe, it, expect, beforeEach } from "vitest";
import {
  TOOL_GROUPS,
  CORE_TOOL_NAMES,
  enableGroup,
  getActiveToolNames,
  filterTools,
  resetGroups,
  getEnabledGroups,
  enableToolsTool,
  runEnableTools,
} from "./tool-groups.js";

describe("tool-groups", () => {
  beforeEach(() => {
    resetGroups();
  });

  describe("CORE_TOOL_NAMES", () => {
    it("includes essential tools", () => {
      for (const name of ["shell", "file_read", "file_edit", "grep", "glob", "delegate", "enable_tools"]) {
        expect(CORE_TOOL_NAMES.has(name)).toBe(true);
      }
    });

    it("does not include extended tools", () => {
      for (const name of ["web_search", "code_exec", "todo", "multi_edit"]) {
        expect(CORE_TOOL_NAMES.has(name)).toBe(false);
      }
    });
  });

  describe("enableGroup", () => {
    it("enables a valid group and returns its tools", () => {
      const result = enableGroup("web");
      expect(result.error).toBeUndefined();
      expect(result.tools).toEqual(["web_search", "web_fetch", "http_request"]);
      expect(getEnabledGroups()).toEqual(["web"]);
    });

    it("enables all groups at once", () => {
      const result = enableGroup("all");
      expect(result.error).toBeUndefined();
      expect(result.tools.length).toBeGreaterThan(0);
      expect(getEnabledGroups()).toEqual(Object.keys(TOOL_GROUPS).sort());
    });

    it("returns error for unknown group", () => {
      const result = enableGroup("nonexistent");
      expect(result.error).toContain("Unknown group");
      expect(result.tools).toEqual([]);
    });

    it("is idempotent — enabling same group twice does not duplicate", () => {
      enableGroup("web");
      enableGroup("web");
      expect(getEnabledGroups()).toEqual(["web"]);
    });
  });

  describe("getActiveToolNames", () => {
    it("returns only core tools by default", () => {
      const active = getActiveToolNames();
      for (const name of CORE_TOOL_NAMES) {
        expect(active.has(name)).toBe(true);
      }
      expect(active.has("web_search")).toBe(false);
    });

    it("includes group tools after enabling", () => {
      enableGroup("code");
      const active = getActiveToolNames();
      expect(active.has("code_exec")).toBe(true);
    });

    it("includes multiple groups", () => {
      enableGroup("web");
      enableGroup("management");
      const active = getActiveToolNames();
      expect(active.has("web_search")).toBe(true);
      expect(active.has("todo")).toBe(true);
      expect(active.has("code_exec")).toBe(false);
    });
  });

  describe("filterTools", () => {
    const mockTools = [
      { name: "shell", description: "", input_schema: { type: "object" as const, properties: {} } },
      { name: "web_search", description: "", input_schema: { type: "object" as const, properties: {} } },
      { name: "code_exec", description: "", input_schema: { type: "object" as const, properties: {} } },
    ];

    it("keeps core tools and filters extended tools", () => {
      const filtered = filterTools(mockTools);
      const names = filtered.map((t) => t.name);
      expect(names).toContain("shell");
      expect(names).not.toContain("web_search");
      expect(names).not.toContain("code_exec");
    });

    it("always includes enable_tools even when not in input", () => {
      const filtered = filterTools(mockTools);
      expect(filtered.some((t) => t.name === "enable_tools")).toBe(true);
    });

    it("includes enabled group tools", () => {
      enableGroup("web");
      const filtered = filterTools(mockTools);
      const names = filtered.map((t) => t.name);
      expect(names).toContain("shell");
      expect(names).toContain("web_search");
      expect(names).not.toContain("code_exec");
    });

    it("does not duplicate enable_tools if already in input", () => {
      const withEnableTools = [...mockTools, enableToolsTool];
      const filtered = filterTools(withEnableTools);
      const count = filtered.filter((t) => t.name === "enable_tools").length;
      expect(count).toBe(1);
    });
  });

  describe("resetGroups", () => {
    it("clears all enabled groups", () => {
      enableGroup("web");
      enableGroup("code");
      resetGroups();
      expect(getEnabledGroups()).toEqual([]);
      expect(getActiveToolNames().has("web_search")).toBe(false);
    });
  });

  describe("enableToolsTool", () => {
    it("has correct name and lists groups", () => {
      expect(enableToolsTool.name).toBe("enable_tools");
      for (const group of Object.keys(TOOL_GROUPS)) {
        expect(enableToolsTool.description).toContain(group);
      }
    });
  });

  describe("runEnableTools", () => {
    it("enables valid groups and lists activated tools", async () => {
      const result = await runEnableTools({ groups: ["web", "code"] });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("web_search");
      expect(result.content).toContain("code_exec");
    });

    it("returns error for empty groups array", async () => {
      const result = await runEnableTools({ groups: [] });
      expect(result.is_error).toBe(true);
    });

    it("returns error for unknown group", async () => {
      const result = await runEnableTools({ groups: ["bad"] });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Unknown group");
    });

    it("handles mix of valid and invalid groups", async () => {
      const result = await runEnableTools({ groups: ["web", "bad"] });
      expect(result.is_error).toBe(true);
    });
  });
});
