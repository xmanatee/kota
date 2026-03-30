import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions, WorkflowDefinitionError } from "./validation.js";
import { VALID_MODEL_IDS } from "./validation-steps.js";

describe("workflow validation", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-workflow-validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "workflows", "builder"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("validates a code-defined workflow registry", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/workflows/builder/prompt.md",
            },
          ],
        }),
      ],
      projectDir,
    );

    expect(definitions[0]).toMatchObject({
      name: "builder",
      definitionPath: "test/builder.ts",
      enabled: true,
      triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
    });
  });

  it("accepts trigger filters with multiple allowed values", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/improver.ts", {
          name: "improver",
          triggers: [
            {
              event: "workflow.completed",
              filter: {
                workflow: "builder",
                status: ["success", "failed"],
              },
            },
          ],
          steps: [
            {
              id: "mark",
              type: "emit",
              event: "improver.done",
            },
          ],
        }),
      ],
      projectDir,
    );

    expect(definitions[0]?.triggers[0]?.filter).toEqual({
      workflow: "builder",
      status: ["success", "failed"],
    });
  });

  it("accepts exposeOutputToAgent on workflow steps", () => {
    const definitions = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/explorer.ts", {
          name: "explorer",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "claim-task",
              type: "code",
              exposeOutputToAgent: true,
              run: () => ({ chosenTaskId: "task-demo" }),
            },
            {
              id: "build",
              type: "emit",
              event: "builder.done",
            },
          ],
        }),
      ],
      projectDir,
    );

    expect(definitions[0]?.steps[0]).toMatchObject({
      id: "claim-task",
      exposeOutputToAgent: true,
    });
  });

  it("accepts repair checks with severity and code validators", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/prompt.md",
                repairLoop: {
                  maxRepairAttempts: 2,
                  checks: [
                    {
                      id: "queue-valid",
                      type: "code",
                      severity: "error",
                      run: () => ({ ok: true }),
                    },
                    {
                      id: "lint-warning",
                      severity: "warning",
                      tool: "shell",
                      input: { command: "npm run lint" },
                    },
                  ],
                },
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).not.toThrow();
  });

  it("rejects non-boolean exposeOutputToAgent values", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/explorer.ts", {
            name: "explorer",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "claim-task",
                type: "code",
                exposeOutputToAgent: "yes" as never,
                run: () => ({ chosenTaskId: "task-demo" }),
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("rejects missing prompt files", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/missing.md",
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow('promptPath does not exist: src/workflows/builder/missing.md');
  });

  it("rejects duplicate workflow names", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/prompt.md",
              },
            ],
          }),
          registerWorkflowDefinition("test/another-builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "again",
                type: "emit",
                event: "builder.done",
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow(WorkflowDefinitionError);
  });

  it("requires restart steps to declare prior verification steps", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/prompt.md",
              },
              {
                id: "request-restart",
                type: "restart",
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow(
      'restart step "request-restart" must declare at least one required verification step',
    );
  });

  it("requires restart verification steps to be prior tool or code steps", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/prompt.md",
              },
              {
                id: "request-restart",
                type: "restart",
                requires: ["build"],
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow(
      'restart step "request-restart" may only require tool, code, or parallel steps, got "agent" for "build"',
    );
  });

  it("requires restart to be the final workflow step", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "verify",
                type: "code",
                run: () => "ok",
              },
              {
                id: "request-restart",
                type: "restart",
                requires: ["verify"],
              },
              {
                id: "after",
                type: "emit",
                event: "builder.done",
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow('restart step "request-restart" must be the final step');
  });

  it("rejects unknown model IDs in agent steps", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/prompt.md",
                model: "gpt-4-turbo",
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).toThrow('steps[0].model: unknown model "gpt-4-turbo"');
  });

  it("accepts known model IDs in agent steps", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    for (const model of VALID_MODEL_IDS) {
      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition("test/builder.ts", {
              name: "builder",
              triggers: [{ event: "runtime.idle" }],
              steps: [
                {
                  id: "build",
                  type: "agent",
                  promptPath: "src/workflows/builder/prompt.md",
                  model,
                },
              ],
            }),
          ],
          projectDir,
        ),
      ).not.toThrow();
    }
  });

  it("accepts agent steps without a model field", () => {
    writeFileSync(
      join(projectDir, "src", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );

    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/builder.ts", {
            name: "builder",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "build",
                type: "agent",
                promptPath: "src/workflows/builder/prompt.md",
              },
            ],
          }),
        ],
        projectDir,
      ),
    ).not.toThrow();
  });

  it("exposes the built-in explorer, builder, improver, and attention-digest workflows", () => {
    const definitions = validateWorkflowDefinitions(
      getBuiltinWorkflowDefinitions(),
      process.cwd(),
    );

    expect(definitions.map((definition) => definition.name)).toEqual([
      "explorer",
      "builder",
      "improver",
      "attention-digest",
    ]);
  });

  it("keeps the built-in explorer, builder, and improver workflows uncapped by daily budgets", () => {
    const definitions = validateWorkflowDefinitions(
      getBuiltinWorkflowDefinitions(),
      process.cwd(),
    );

    expect(definitions.every((definition) => definition.dailyBudgetUsd == null)).toBe(true);
  });

  it("rejects a workflow.completed trigger with no workflow filter (self-trigger loop)", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/notifier.ts", {
            name: "notifier",
            triggers: [{ event: "workflow.completed" }],
            steps: [{ id: "notify", type: "emit", event: "notifier.done" }],
          }),
        ],
        projectDir,
      ),
    ).toThrow(/infinite loop/);
  });

  it("rejects a workflow.completed trigger whose workflow filter includes its own name", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/notifier.ts", {
            name: "notifier",
            triggers: [
              {
                event: "workflow.completed",
                filter: { workflow: ["explorer", "notifier"] },
              },
            ],
            steps: [{ id: "notify", type: "emit", event: "notifier.done" }],
          }),
        ],
        projectDir,
      ),
    ).toThrow(/infinite loop/);
  });

  it("accepts a workflow.completed trigger with a workflow filter that excludes itself", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("test/notifier.ts", {
            name: "notifier",
            triggers: [
              {
                event: "workflow.completed",
                filter: { workflow: ["explorer", "builder"] },
              },
            ],
            steps: [{ id: "notify", type: "emit", event: "notifier.done" }],
          }),
        ],
        projectDir,
      ),
    ).not.toThrow();
  });
});
