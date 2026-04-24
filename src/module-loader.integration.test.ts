/**
 * Cross-module integration tests for ModuleLoader.
 *
 * These scenarios verify the loader end-to-end by loading real modules
 * (scheduler, memory with rendering) and exercising the registered
 * tools. Cross-cutting #modules/* imports keep this test at the src/
 * root tier rather than under src/core/.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { clearCustomTools, executeTool, getAllTools } from "#core/tools/index.js";
import {
  clearCustomGroups,
  enableGroup,
  filterTools,
  resetGroups,
  TOOL_GROUPS,
} from "#core/tools/tool-groups.js";

describe("scheduler module integration", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
  });

  it("registers the schedule tool via module protocol", async () => {
    const { default: schedulerModule } = await import("#modules/scheduler/index.js");
    const loader = new ModuleLoader({});

    await loader.load(schedulerModule);
    expect(loader.getLoadedModules()).toEqual(["scheduler"]);
    expect(loader.getToolCount()).toBe(1);

    // Schedule tool should be in the management group
    expect(TOOL_GROUPS.management).toContain("schedule");

    // Should be callable
    const result = await executeTool("schedule", { action: "list" });
    expect(result.is_error).toBeFalsy();
  });

  it("schedule tool is hidden until management group is enabled", async () => {
    const { default: schedulerModule } = await import("#modules/scheduler/index.js");
    const loader = new ModuleLoader({});
    await loader.load(schedulerModule);

    const before = filterTools(getAllTools());
    expect(before.some((t) => t.name === "schedule")).toBe(false);

    enableGroup("management");
    const after = filterTools(getAllTools());
    expect(after.some((t) => t.name === "schedule")).toBe(true);
  });
});

describe("memory module integration", () => {
  beforeEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    resetProviderRegistry();
  });

  afterEach(() => {
    clearCustomTools();
    clearCustomGroups();
    resetGroups();
    resetProviderRegistry();
  });

  it("registers the memory tool via module protocol", async () => {
    const { default: renderingModule } = await import("#modules/rendering/index.js");
    const { default: memoryModule } = await import("#modules/memory/index.js");
    const loader = new ModuleLoader({});

    await loader.load(renderingModule);
    await loader.load(memoryModule);
    expect(loader.getLoadedModules()).toEqual(["rendering", "memory"]);
    expect(loader.getToolCount()).toBe(1);

    // Memory tool should be in the management group
    expect(TOOL_GROUPS.management).toContain("memory");

    // Should be callable
    const result = await executeTool("memory", { action: "list" });
    expect(result.is_error).toBeFalsy();
  });

  it("memory tool is hidden until management group is enabled", async () => {
    const { default: renderingModule } = await import("#modules/rendering/index.js");
    const { default: memoryModule } = await import("#modules/memory/index.js");
    const loader = new ModuleLoader({});
    await loader.load(renderingModule);
    await loader.load(memoryModule);

    const before = filterTools(getAllTools());
    expect(before.some((t) => t.name === "memory")).toBe(false);

    enableGroup("management");
    const after = filterTools(getAllTools());
    expect(after.some((t) => t.name === "memory")).toBe(true);
  });
});
