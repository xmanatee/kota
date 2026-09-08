import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeModuleLoader } from "./core/modules/module-context.test-helpers.js";
import { executeTool, } from "./core/tools/index.js";
import { resetGroups } from "./core/tools/tool-groups.js";
import filesystemModule from "./modules/filesystem/index.js";
import renderingModule from "./modules/rendering/index.js";

let testDir: string;
let loader: ReturnType<typeof createRuntimeModuleLoader>;

beforeAll(async () => {
  loader = createRuntimeModuleLoader({});
  await loader.loadAll([renderingModule, filesystemModule]);
});

afterAll(async () => {
  await loader.unloadAll();
});

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "fo-int-"));
});

afterEach(async () => {
  resetGroups();
  await rm(testDir, { recursive: true, force: true });
});

describe("files_overview × executeTool (cross-module dispatch)", () => {
  it("dispatches through executeTool and returns structured output", async () => {
    await writeFile(join(testDir, "readme.md"), "# My Project\nHello");
    await writeFile(join(testDir, "data.csv"), "name,age\nAlice,30\nBob,25");
    await writeFile(join(testDir, "config.json"), '{"key": "value"}');

    const result = await executeTool("files_overview", { path: testDir });
    expect(result.is_error).toBeUndefined();
    const text = result.content as string;
    expect(text).toContain("3 files");
    expect(text).toContain("Documents");
    expect(text).toContain("Data");
    // Previews flow through
    expect(text).toContain("My Project");
    expect(text).toContain("2 rows");
  });
});
