import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import { executeTool, getModuleToolNames } from "#core/tools/index.js";
import renderingModule from "#modules/rendering/index.js";
import memoryModule from "./index.js";

describe("memory module lifecycle", () => {
  let root: string;
  let loader: ModuleLoader;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-memory-lifecycle-"));
    loader = new ModuleLoader({}, false, {
      providerRegistry: new ProviderRegistry(),
    });
    loader.setCwd(root);
    loader.setBus(new EventBus());
  });

  afterEach(async () => {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  });

  it("makes persisted memory behavior available only while the module is active", async () => {
    await loader.load(renderingModule);
    await loader.load(memoryModule);

    expect(getModuleToolNames("memory")).toEqual(["memory"]);
    expect(
      await executeTool("memory", {
        action: "save",
        content: "Use behavior-level lifecycle tests",
      }),
    ).toMatchObject({ content: expect.stringContaining("Saved memory") });
    expect(
      await executeTool("memory", { action: "search", query: "behavior" }),
    ).toMatchObject({ content: expect.stringContaining("behavior-level") });

    await loader.unload("memory");
    expect(getModuleToolNames("memory")).toEqual([]);
  });
});
