import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverModules } from "#core/modules/module-discovery.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { discoverProjectModules } from "#core/modules/project-discovery.js";
import {
  getKnowledgeProvider,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";

describe("module loader lifecycle modes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-command-loader-"));
    resetProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("commands mode exposes static contributions but refuses runtime accessors", async () => {
    const config = { defaultAgentHarness: "claude-agent-sdk" };
    const projectModules = await discoverProjectModules();
    const installedModules = await discoverModules(projectDir);
    const loader = new ModuleLoader(config, false, { mode: "commands" });
    loader.setCwd(projectDir);
    await loader.loadAll(projectModules, installedModules);

    expect(() => getKnowledgeProvider()).toThrow(/knowledge provider/);
    expect(() => loader.getRoutes()).toThrow(/lifecycle mode "runtime"/);
    expect(() => loader.getContributedControlRoutes()).toThrow(/lifecycle mode "runtime"/);
    await expect(loader.probeHealthChecks()).rejects.toThrow(/lifecycle mode "runtime"/);

    expect(() => loader.getContributedWorkflows()).not.toThrow();
    expect(() => loader.getContributedChannels()).not.toThrow();
    expect(() => loader.getSkillsPrompt()).not.toThrow();
    expect(() => loader.getAgentDef("nonexistent")).not.toThrow();
  });
});
