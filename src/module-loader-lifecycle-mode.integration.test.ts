import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverBundledModules } from "#core/modules/bundled-module-discovery.js";
import { discoverModules } from "#core/modules/module-discovery.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import {
  getKnowledgeProvider,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";

describe("module loader lifecycle modes", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-command-loader-"));
    resetProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("commands mode exposes static contributions but refuses runtime accessors", async () => {
    const config = { defaultAgentHarness: "claude-agent-sdk" };
    const bundledModules = await discoverBundledModules();
    const installedModules = await discoverModules(scopeRoot);
    const loader = new ModuleLoader(config, false, { mode: "commands" });
    loader.setCwd(scopeRoot);
    await loader.loadAll(bundledModules, installedModules);

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
