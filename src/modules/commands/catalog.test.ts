import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleSummary } from "#core/modules/module-types.js";
import { resolveKotaRuntimeAsset } from "#core/util/kota-install-paths.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { buildSlashCommandCatalog, COMMAND_WORKFLOW_TAG } from "./catalog.js";

function makeWorkflow(
  name: string,
  opts: Partial<RegisteredWorkflowDefinitionInput> = {},
): RegisteredWorkflowDefinitionInput {
  return {
    repository: "read",
    name,
    description: opts.description,
    triggers: opts.triggers ?? [{ event: "manual" }],
    steps: opts.steps ?? [],
    tags: opts.tags,
    definitionPath: opts.definitionPath ?? `modules/${name}`,
    contributingModule: opts.contributingModule ?? "autonomy",
    moduleSource: opts.moduleSource,
  };
}

function makeSummary(
  name: string,
  skills: ModuleSummary["skills"],
): ModuleSummary {
  return {
    name,
    source: "bundled",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    channelNames: [],
    skillNames: skills.map((s) => s.name),
    agentNames: [],
    agents: [],
    skills,
    commandNames: [],
    routeSummaries: [],
  };
}

describe("buildSlashCommandCatalog", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kota-commands-"));
    mkdirSync(join(tmp, "skills"), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("lists workflow commands only for workflows tagged with COMMAND_WORKFLOW_TAG", () => {
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [
        makeWorkflow("builder", { tags: [COMMAND_WORKFLOW_TAG], description: "Run builder" }),
        makeWorkflow("internal-dispatcher", {}),
      ],
      getModuleSummaries: () => [],
      scopeRoot: tmp,
    });

    const names = catalog.list().map((c) => c.name);
    expect(names).toEqual(["builder"]);
    const [builder] = catalog.list();
    expect(builder).toMatchObject({
      name: "builder",
      label: "/builder",
      description: "Run builder",
      source: "workflow",
    });
  });

  it("lists every contributed skill as skill:<name>", () => {
    writeFileSync(join(tmp, "skills", "deep-research.md"), "deep research body");
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [],
      getModuleSummaries: () => [
        makeSummary("research", [
          {
            name: "deep-research",
            description: "Thorough investigation",
            promptPath: "skills/deep-research.md",
          },
        ]),
      ],
      scopeRoot: tmp,
    });

    const cmds = catalog.list();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({
      name: "skill:deep-research",
      label: "/skill:deep-research",
      source: "skill",
      module: "research",
      description: "Thorough investigation",
    });
  });

  it("resolves a workflow command to a workflow action", () => {
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [
        makeWorkflow("builder", { tags: [COMMAND_WORKFLOW_TAG] }),
      ],
      getModuleSummaries: () => [],
      scopeRoot: tmp,
    });
    expect(catalog.resolve("builder")).toEqual({ kind: "workflow", workflow: "builder" });
  });

  it("refuses to resolve an untagged workflow as a slash command", () => {
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [makeWorkflow("internal", {})],
      getModuleSummaries: () => [],
      scopeRoot: tmp,
    });
    expect(catalog.resolve("internal")).toBeNull();
  });

  it.each(["relative", "absolute"])("resolves an installed skill's %s prompt path", (pathKind) => {
    writeFileSync(join(tmp, "skills", "deep-research.md"), "  investigate thoroughly  \n");
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [],
      getModuleSummaries: () => [
        {
          ...makeSummary("research", [{
            name: "deep-research",
            promptPath: pathKind === "absolute"
              ? join(tmp, "skills/deep-research.md")
              : "skills/deep-research.md",
          }]),
          source: "installed",
        },
      ],
      scopeRoot: tmp,
    });
    expect(catalog.resolve("skill:deep-research")).toEqual({
      kind: "skill",
      prompt: "investigate thoroughly",
    });
  });

  it("resolves bundled skill assets outside KOTA while preserving project-local precedence", () => {
    const promptPath = "src/modules/memory/memory.md";
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [],
      getModuleSummaries: () => [makeSummary("memory", [{ name: "memory", promptPath }])],
      scopeRoot: tmp,
    });

    expect(catalog.resolve("skill:memory")).toEqual({
      kind: "skill",
      prompt: readFileSync(resolveKotaRuntimeAsset(promptPath), "utf8").trim(),
    });

    const projectPromptPath = join(tmp, promptPath);
    mkdirSync(dirname(projectPromptPath), { recursive: true });
    writeFileSync(projectPromptPath, "Project-local memory guidance.\n");
    expect(catalog.resolve("skill:memory")).toEqual({
      kind: "skill",
      prompt: "Project-local memory guidance.",
    });
  });

  it("returns null for unknown command names", () => {
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [],
      getModuleSummaries: () => [],
      scopeRoot: tmp,
    });
    expect(catalog.resolve("nope")).toBeNull();
    expect(catalog.resolve("skill:nope")).toBeNull();
  });

  it("sorts commands alphabetically by name", () => {
    writeFileSync(join(tmp, "skills", "a.md"), "A");
    writeFileSync(join(tmp, "skills", "z.md"), "Z");
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [
        makeWorkflow("mbuilder", { tags: [COMMAND_WORKFLOW_TAG] }),
      ],
      getModuleSummaries: () => [
        makeSummary("research", [
          { name: "z", promptPath: "skills/z.md" },
          { name: "a", promptPath: "skills/a.md" },
        ]),
      ],
      scopeRoot: tmp,
    });
    expect(catalog.list().map((c) => c.name)).toEqual([
      "mbuilder",
      "skill:a",
      "skill:z",
    ]);
  });
});
