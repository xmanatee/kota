import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_TOOL_NAMES,
  enableGroup,
  filterTools,
  resetGroups,
  TOOL_GROUPS,
} from "../tool-groups.js";
import { getAllTools } from "../tools/index.js";
import { EDITOR_TOOL_SET } from "./architect-editor.js";

/**
 * Cross-module integration tests: tool-groups × architect
 *
 * Verifies that the editor pass tool set is independent of
 * tool-group state, and that filterTools behaves correctly
 * for the main loop under various group configurations.
 */

beforeEach(() => resetGroups());

describe("editor tool set independence from tool-group state", () => {
  // The editor uses getAllTools().filter(EDITOR_TOOL_SET) directly,
  // NOT filterTools. These tests verify the contract.

  it("editor gets all EDITOR_TOOL_SET tools even with no groups enabled", () => {
    // No groups enabled — filterTools would restrict to core only
    const viaFilterTools = filterTools(getAllTools())
      .filter((t) => EDITOR_TOOL_SET.has(t.name))
      .map((t) => t.name)
      .sort();

    const direct = getAllTools()
      .filter((t) => EDITOR_TOOL_SET.has(t.name))
      .map((t) => t.name)
      .sort();

    // Direct (what the fixed editor uses) should have MORE tools
    // than filterTools path when groups are not enabled
    expect(direct.length).toBeGreaterThanOrEqual(viaFilterTools.length);

    // code_exec is in the "code" group and in core getAllTools() without extension loading.
    // It should be in direct but NOT in filterTools (its group isn't enabled).
    // Note: web_search/web_fetch are in the web-access extension and only in getAllTools()
    // when the extension is loaded, so we test with code_exec instead.
    expect(direct).toContain("code_exec");
    expect(viaFilterTools).not.toContain("code_exec");
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
    expect(before.has("code_exec")).toBe(false);

    // Enable "code" group — code_exec is a core tool registered in getAllTools()
    enableGroup("code");
    const after = new Set(filterTools(getAllTools()).map((t) => t.name));
    expect(after.has("code_exec")).toBe(true);
    expect(after.has("notebook")).toBe(true);
    expect(after.has("sqlite")).toBe(true);
    // web tools are in the web-access extension; only available after extension loads
  });

  it("resetGroups removes all non-core tools from filterTools", () => {
    enableGroup("all");
    const withAll = filterTools(getAllTools()).map((t) => t.name);
    // code_exec is a core-registered tool in the "code" group
    expect(withAll).toContain("code_exec");
    // web tools are in the web-access extension, only available after extension loads

    resetGroups();
    const afterReset = new Set(filterTools(getAllTools()).map((t) => t.name));
    expect(afterReset.has("code_exec")).toBe(false);
  });

  it("enable_tools is always injected by filterTools", () => {
    const names = filterTools(getAllTools()).map((t) => t.name);
    expect(names).toContain("enable_tools");

    enableGroup("all");
    const namesAll = filterTools(getAllTools()).map((t) => t.name);
    expect(namesAll).toContain("enable_tools");
  });
});
