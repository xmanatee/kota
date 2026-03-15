import { describe, it, expect, beforeEach } from "vitest";
import {
  enableGroup,
  resetGroups,
  filterTools,
  getActiveToolNames,
  CORE_TOOL_NAMES,
  TOOL_GROUPS,
} from "./tool-groups.js";
import { EDITOR_TOOL_SET } from "./architect.js";
import { allTools } from "./tools/index.js";

/**
 * Cross-module integration tests: tool-groups × architect
 *
 * Verifies that the editor pass tool set is independent of
 * tool-group state, and that filterTools behaves correctly
 * for the main loop under various group configurations.
 */

beforeEach(() => resetGroups());

describe("editor tool set independence from tool-group state", () => {
  // The editor uses allTools.filter(EDITOR_TOOL_SET) directly,
  // NOT filterTools. These tests verify the contract.

  it("editor gets all EDITOR_TOOL_SET tools even with no groups enabled", () => {
    // No groups enabled — filterTools would restrict to core only
    const viaFilterTools = filterTools(allTools)
      .filter((t) => EDITOR_TOOL_SET.has(t.name))
      .map((t) => t.name)
      .sort();

    const direct = allTools
      .filter((t) => EDITOR_TOOL_SET.has(t.name))
      .map((t) => t.name)
      .sort();

    // Direct (what the fixed editor uses) should have MORE tools
    // than filterTools path when groups are not enabled
    expect(direct.length).toBeGreaterThanOrEqual(viaFilterTools.length);

    // Specifically, web_search/web_fetch/code_exec should be in direct
    // but NOT in filterTools (since their groups aren't enabled)
    expect(direct).toContain("web_search");
    expect(direct).toContain("web_fetch");
    expect(direct).toContain("code_exec");
    expect(viaFilterTools).not.toContain("web_search");
    expect(viaFilterTools).not.toContain("code_exec");
  });

  it("editor tool set is stable regardless of which groups are enabled", () => {
    const getEditorTools = () =>
      allTools
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
    const filtered = filterTools(allTools).map((t) => t.name);
    for (const core of CORE_TOOL_NAMES) {
      if (allTools.some((t) => t.name === core)) {
        expect(filtered).toContain(core);
      }
    }
  });

  it("enabling a group adds its tools to filterTools output", () => {
    const before = new Set(filterTools(allTools).map((t) => t.name));
    expect(before.has("web_search")).toBe(false);

    enableGroup("web");
    const after = new Set(filterTools(allTools).map((t) => t.name));
    expect(after.has("web_search")).toBe(true);
    expect(after.has("web_fetch")).toBe(true);
    expect(after.has("http_request")).toBe(true);
  });

  it("resetGroups removes all non-core tools from filterTools", () => {
    enableGroup("all");
    const withAll = filterTools(allTools).map((t) => t.name);
    expect(withAll).toContain("web_search");
    expect(withAll).toContain("code_exec");

    resetGroups();
    const afterReset = new Set(filterTools(allTools).map((t) => t.name));
    expect(afterReset.has("web_search")).toBe(false);
    expect(afterReset.has("code_exec")).toBe(false);
  });

  it("enable_tools is always injected by filterTools", () => {
    const names = filterTools(allTools).map((t) => t.name);
    expect(names).toContain("enable_tools");

    enableGroup("all");
    const namesAll = filterTools(allTools).map((t) => t.name);
    expect(namesAll).toContain("enable_tools");
  });
});
