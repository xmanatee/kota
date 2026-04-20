import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { buildSlashCommandCatalog, COMMAND_WORKFLOW_TAG } from "./catalog.js";

function makeWorkflow(
  name: string,
  opts: Partial<RegisteredWorkflowDefinitionInput> = {},
): RegisteredWorkflowDefinitionInput {
  return {
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
    source: "project",
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
      projectDir: tmp,
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
      projectDir: tmp,
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
      projectDir: tmp,
    });
    expect(catalog.resolve("builder")).toEqual({ kind: "workflow", workflow: "builder" });
  });

  it("refuses to resolve an untagged workflow as a slash command", () => {
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [makeWorkflow("internal", {})],
      getModuleSummaries: () => [],
      projectDir: tmp,
    });
    expect(catalog.resolve("internal")).toBeNull();
  });

  it("resolves a skill command to the skill's prompt body", () => {
    writeFileSync(join(tmp, "skills", "deep-research.md"), "  investigate thoroughly  \n");
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [],
      getModuleSummaries: () => [
        makeSummary("research", [
          { name: "deep-research", promptPath: "skills/deep-research.md" },
        ]),
      ],
      projectDir: tmp,
    });
    expect(catalog.resolve("skill:deep-research")).toEqual({
      kind: "skill",
      prompt: "investigate thoroughly",
    });
  });

  it("returns null for unknown command names", () => {
    const catalog = buildSlashCommandCatalog({
      getContributedWorkflows: () => [],
      getModuleSummaries: () => [],
      projectDir: tmp,
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
      projectDir: tmp,
    });
    expect(catalog.list().map((c) => c.name)).toEqual([
      "mbuilder",
      "skill:a",
      "skill:z",
    ]);
  });
});
