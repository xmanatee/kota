import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CORE_TOOL_NAMES,
  enableGroup,
  filterTools,
  resetGroups,
  TOOL_GROUPS,
} from "../tool-groups.js";
import { clearCustomTools, getAllTools, registerTool } from "../tools/index.js";
import { EDITOR_TOOL_SET } from "./architect-editor.js";

/**
 * Cross-module integration tests: tool-groups × architect
 *
 * Verifies that the editor pass tool set is independent of
 * tool-group state, and that filterTools behaves correctly
 * for the main loop under various group configurations.
 */

beforeEach(() => resetGroups());
afterEach(() => clearCustomTools());

describe("editor tool set independence from tool-group state", () => {
  // The editor uses getAllTools().filter(EDITOR_TOOL_SET) directly,
  // NOT filterTools. These tests verify the contract.

  it("editor gets all EDITOR_TOOL_SET tools even with no groups enabled", () => {
    // Register a mock tool that's in EDITOR_TOOL_SET (simulating extension-loaded shell)
    // to verify that the editor uses getAllTools() directly, not filterTools().
    const mockShellTool = {
      name: "shell",
      description: "Execute a shell command",
      input_schema: { type: "object" as const, properties: {} },
    };
    registerTool(mockShellTool, async () => ({ content: "ok" }), "test-execution");

    // No groups enabled — filterTools would restrict non-core tools based on group state
    const viaFilterTools = filterTools(getAllTools())
      .filter((t) => EDITOR_TOOL_SET.has(t.name))
      .map((t) => t.name)
      .sort();

    const direct = getAllTools()
      .filter((t) => EDITOR_TOOL_SET.has(t.name))
      .map((t) => t.name)
      .sort();

    // Direct (what the editor uses) should have MORE or equal tools than filterTools
    expect(direct.length).toBeGreaterThanOrEqual(viaFilterTools.length);

    // shell is in EDITOR_TOOL_SET and in getAllTools() (via registered extension tool)
    // It appears in direct regardless of group state
    expect(direct).toContain("shell");
  });

  it("editor tool set is stable regardless of which groups are enabled", () => {
    const getEditorTools = () =>
      getAllTools()
        .filter((t) => EDITOR_TOOL_SET.has(t.name))
        .map((t) => t.name)
        .sort();

    const baseline = getEditorTools();

    enableGroup("web");
    expect(getEditorTools()).toEqual(baseline);

    enableGroup("code");
    expect(getEditorTools()).toEqual(baseline);

    enableGroup("all");
    expect(getEditorTools()).toEqual(baseline);
  });

  it("EDITOR_TOOL_SET includes tools from multiple groups", () => {
    // Verify the editor needs tools spanning web, code, and core
    const editorToolNames = [...EDITOR_TOOL_SET];
    const webTools = TOOL_GROUPS.web;
    const codeTools = TOOL_GROUPS.code;

    const hasWeb = editorToolNames.some((t) => webTools.includes(t));
    const hasCode = editorToolNames.some((t) => codeTools.includes(t));
    const hasCore = editorToolNames.some((t) => CORE_TOOL_NAMES.has(t));

    expect(hasWeb).toBe(true);
    expect(hasCode).toBe(true);
    expect(hasCore).toBe(true);
  });
});

describe("filterTools main-loop behavior with group state", () => {
  it("core tools always present even with no groups enabled", () => {
    const filtered = filterTools(getAllTools()).map((t) => t.name);
    for (const core of CORE_TOOL_NAMES) {
      if (getAllTools().some((t) => t.name === core)) {
        expect(filtered).toContain(core);
      }
    }
  });

  it("enabling a group adds its tools to filterTools output", () => {
    const before = new Set(filterTools(getAllTools()).map((t) => t.name));
    expect(before.has("sqlite")).toBe(false);

    // Enable "code" group — sqlite is a core tool registered in getAllTools()
    // (notebook and code_exec are now in extensions, not in core)
    enableGroup("code");
    const after = new Set(filterTools(getAllTools()).map((t) => t.name));
    expect(after.has("sqlite")).toBe(true);
    // web tools are in the web-access extension; only available after extension loads
    // code_exec and notebook are in extensions; only available after extension loads
  });

  it("resetGroups removes all non-core tools from filterTools", () => {
    enableGroup("all");
    const withAll = filterTools(getAllTools()).map((t) => t.name);
    // sqlite is a core-registered tool in the "code" group
    // (notebook and code_exec are now in extensions, not in core)
    expect(withAll).toContain("sqlite");
    // web tools are in the web-access extension, only available after extension loads
    // code_exec and notebook are in extensions, only available after extension loads

    resetGroups();
    const afterReset = new Set(filterTools(getAllTools()).map((t) => t.name));
    expect(afterReset.has("sqlite")).toBe(false);
  });

  it("enable_tools is always injected by filterTools", () => {
    const names = filterTools(getAllTools()).map((t) => t.name);
    expect(names).toContain("enable_tools");

    enableGroup("all");
    const namesAll = filterTools(getAllTools()).map((t) => t.name);
    expect(namesAll).toContain("enable_tools");
  });
});
