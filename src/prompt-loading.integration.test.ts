// Detects consumers bypassing shared prompt authorization, including cached
// module skill content and catalog reads after module admission.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDef } from "#core/agents/agent-types.js";
import { createModuleLoader } from "#core/modules/module-context.test-helpers.js";
import type { SlashCommandCatalog } from "#core/modules/slash-command-provider.js";
import { buildSystemPrompt } from "#core/tools/handoff-agent-runtime-helpers.js";
import { catalogFromModuleContext } from "#modules/commands/catalog.js";

describe("shared prompt consumer containment", () => {
  let root: string;
  let scope: string;
  let external: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-prompt-consumers-"));
    scope = join(root, "scope");
    external = join(root, "external");
    mkdirSync(scope);
    mkdirSync(external);
    writeFileSync(join(external, "prompt.md"), "EXTERNAL SENTINEL");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const agent = (promptPath: string): AgentDef => ({
    name: "reviewer", role: "Review", promptPath, model: "test", effort: "low", writeScope: [],
  });

  it("rejects a bundled override link in the catalog, module cache and delegated system prompt", async () => {
    const promptPath = "src/modules/memory/memory.md";
    const override = join(scope, promptPath);
    mkdirSync(dirname(override), { recursive: true });
    symlinkSync(join(external, "prompt.md"), override);
    const loader = createModuleLoader({});
    loader.setCwd(scope);
    let catalog: SlashCommandCatalog | undefined;
    await loader.load({
      name: "memory", skills: [{ name: "memory", promptPath }],
      onLoad: ctx => { catalog = catalogFromModuleContext(ctx); },
    });
    expect(loader.getSkillsPrompt()).toBe("");
    expect(catalog).toBeDefined();
    expect(() => catalog!.resolve("skill:memory")).toThrow(/Unsafe filesystem path/);
    expect(buildSystemPrompt(agent(promptPath), scope, undefined)).toMatchObject({ is_error: true });
    rmSync(override);
    writeFileSync(override, "LOCAL CONTROL");
    expect(catalog!.resolve("skill:memory")).toEqual({ kind: "skill", prompt: "LOCAL CONTROL" });
    expect(buildSystemPrompt(agent(promptPath), scope, undefined)).toBe("LOCAL CONTROL");
    await loader.unloadAll();
  });

  it("propagates host-authorized external assets to module loading and its command context", async () => {
    const loader = createModuleLoader({}, false, { trustedPromptRoots: [external] });
    loader.setCwd(scope);
    let catalog: SlashCommandCatalog | undefined;
    const promptPath = join(external, "prompt.md");
    await loader.load({
      name: "external", skills: [{ name: "external", promptPath }],
      onLoad: ctx => { catalog = catalogFromModuleContext(ctx); },
    });
    expect(loader.getSkillsPrompt()).toContain("EXTERNAL SENTINEL");
    expect(catalog!.resolve("skill:external")).toEqual({ kind: "skill", prompt: "EXTERNAL SENTINEL" });
    rmSync(promptPath);
    writeFileSync(join(root, "private.md"), "UNAUTHORIZED SENTINEL");
    symlinkSync(join(root, "private.md"), promptPath);
    expect(() => catalog!.resolve("skill:external")).toThrow(/Unsafe filesystem path/);
    await loader.unloadAll();
  });
});
