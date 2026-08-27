import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureJsonObject } from "./fixture-common-types.js";

export function writeImportedSkill(params: {
  fixtureDir: string;
  name: string;
  body: string;
  frontmatter?: string;
}): void {
  const skillDir = join(params.fixtureDir, "initial", ".kota", "skills", params.name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      params.frontmatter ?? `name: ${params.name}`,
      "---",
      params.body,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(skillDir, "kota-import.json"),
    JSON.stringify(
      {
        version: 1,
        skillName: params.name,
        source: "fixture",
        sourceKind: "local",
        selectedSkillPath: `${params.name}/SKILL.md`,
        provenance: "fixture-local imported skill",
        importedFiles: ["SKILL.md"],
        skippedFiles: [],
      },
      null,
      2,
    ),
  );
}

function skillAblationVariantFixture(params: {
  id: string;
  workflowName: string;
  agentName: string;
  agentStepId: string;
  selectedSkills: readonly string[];
  skillProvenance: "none" | "imported";
  expectedOutcome: "pass" | "fail";
  promptEvidence: {
    requiredNeedles?: readonly string[];
    forbiddenNeedles?: readonly string[];
  };
}): FixtureJsonObject {
  return {
    id: params.id,
    workflowName: params.workflowName,
    agentName: params.agentName,
    agentStepId: params.agentStepId,
    selectedSkills: [...params.selectedSkills],
    skillProvenance: params.skillProvenance,
    expectedOutcome: params.expectedOutcome,
    promptEvidence: {
      ...(params.promptEvidence.requiredNeedles !== undefined && {
        requiredNeedles: [...params.promptEvidence.requiredNeedles],
      }),
      ...(params.promptEvidence.forbiddenNeedles !== undefined && {
        forbiddenNeedles: [...params.promptEvidence.forbiddenNeedles],
      }),
    },
    preRunExpectations: [
      {
        predicate: { kind: "file-exists", path: "output/ticket-summary.json" },
        expected: "fail",
      },
      {
        predicate: {
          kind: "file-exists",
          path: "data/tasks/task-normalize-ticket-json.md",
        },
        expected: "pass",
      },
    ],
    predicates: [
      {
        kind: "file-absent",
        path: "data/tasks/task-normalize-ticket-json.md",
      },
      {
        kind: "file-exists",
        path: "data/tasks/archive/task-normalize-ticket-json.md",
      },
      {
        kind: "file-contains",
        path: "output/ticket-summary.json",
        needle: '"valid": true',
      },
      {
        kind: "file-contains",
        path: "output/ticket-summary.json",
        needle: '"routing": "release"',
      },
      {
        kind: "git-changes-within",
        allowedPaths: [
          "data/tasks/task-normalize-ticket-json.md",
          "data/tasks/archive/task-normalize-ticket-json.md",
          "output/ticket-summary.json",
        ],
      },
    ],
  };
}

export function writeSkillAblationFixture(
  fixturesRoot: string,
  params: {
    id?: string;
    focusedSkillFrontmatter?: string;
  } = {},
): void {
  const id = params.id ?? "skill-ablation-mini";
  const fixtureDir = join(fixturesRoot, id);
  mkdirSync(join(fixtureDir, "initial", "data", "tasks"), {
    recursive: true,
  });
  writeFileSync(
    join(fixtureDir, "initial", "data", "tasks", "task-normalize-ticket-json.md"),
    [
      "---",
      "status: open",
      "priority: p2",
      "---",
      "",
      "# Normalize ticket JSON",
      "",
      "Normalize T-1042 ticket JSON.",
      "",
    ].join("\n"),
  );
  writeImportedSkill({
    fixtureDir,
    name: "focused-procedure",
    frontmatter: params.focusedSkillFrontmatter,
    body: [
      "Ticket JSON Normalization Procedure",
      "Compute routing as release after validating required fields.",
    ].join("\n"),
  });
  writeImportedSkill({
    fixtureDir,
    name: "outdated-procedure",
    body: [
      "Outdated Ticket Procedure",
      "Set routing to pending-review when the ticket has any optional field.",
    ].join("\n"),
  });
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify(
      {
        id,
        description: "skill ablation runner fixture",
        role: "builder",
        mode: "skill-ablation",
        budgetMs: 60_000,
        variants: [
          skillAblationVariantFixture({
            id: "no-skill",
            workflowName: "skill-ablation-no-skill",
            agentName: "skill-ablation-no-skill-agent",
            agentStepId: "solve-no-skill",
            selectedSkills: [],
            skillProvenance: "none",
            expectedOutcome: "fail",
            promptEvidence: {
              forbiddenNeedles: [
                "Ticket JSON Normalization Procedure",
                "Outdated Ticket Procedure",
              ],
            },
          }),
          skillAblationVariantFixture({
            id: "focused-skill",
            workflowName: "skill-ablation-focused-skill",
            agentName: "skill-ablation-focused-skill-agent",
            agentStepId: "solve-focused-skill",
            selectedSkills: ["focused-procedure"],
            skillProvenance: "imported",
            expectedOutcome: "pass",
            promptEvidence: {
              requiredNeedles: [
                "Ticket JSON Normalization Procedure",
                "Compute routing as release",
              ],
              forbiddenNeedles: ["Outdated Ticket Procedure"],
            },
          }),
          skillAblationVariantFixture({
            id: "noisy-skill",
            workflowName: "skill-ablation-noisy-skill",
            agentName: "skill-ablation-noisy-skill-agent",
            agentStepId: "solve-noisy-skill",
            selectedSkills: ["outdated-procedure"],
            skillProvenance: "imported",
            expectedOutcome: "fail",
            promptEvidence: {
              requiredNeedles: [
                "Outdated Ticket Procedure",
                "routing to pending-review",
              ],
              forbiddenNeedles: ["Ticket JSON Normalization Procedure"],
            },
          }),
        ],
        expectedDirection: {
          kind: "treatment-passes-control-fails",
          controlVariantId: "no-skill",
          treatmentVariantId: "focused-skill",
          noisyVariantId: "noisy-skill",
          summary: "The focused skill should be the only passing variant.",
        },
        controlDecisions: ["act"],
        provenance: {
          kind: "smoke-fixture",
          justification: "tests skill-ablation runner wiring",
        },
      },
      null,
      2,
    ),
  );
}
