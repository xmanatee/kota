import { describe, expect, it } from "vitest";
import { buildModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { assembleWorkflowGraph } from "./assemble.js";
import { formatCompact, formatDot, formatTable } from "./format.js";

function makeDef(
  overrides: Partial<RegisteredWorkflowDefinitionInput> &
    Pick<RegisteredWorkflowDefinitionInput, "name" | "repository">,
): RegisteredWorkflowDefinitionInput {
  return {
    definitionPath: `src/modules/test/workflows/${overrides.name}/workflow.ts`,
    triggers: [{ event: "runtime.idle" }],
    steps: [],
    ...overrides,
  };
}

const SAMPLE_DEFS: RegisteredWorkflowDefinitionInput[] = [
  makeDef({
    repository: "read",
    name: "dispatcher",
    description: "Dispatches events based on repo state",
    triggers: [{ event: "runtime.idle", cooldownMs: 30000 }],
    steps: [
      { type: "code", id: "assess", run: () => {} },
      { type: "emit", id: "e1", event: "autonomy.queue.available" },
    ],
  }),
  makeDef({
    repository: "read",
    name: "builder",
    description: "Builds one task",
    tags: ["monitored"],
    triggers: [{ event: "autonomy.queue.available" }],
    steps: [
      { type: "code", id: "inspect", run: () => {} },
      {
        type: "agent",
        id: "build",
        agentName: "builder",
        model: "claude-opus-4-7",
        effort: "xhigh",
        when: () => true,
      },
      { type: "emit", id: "done", event: "example.completed" },
    ],
  }),
  makeDef({
    repository: "read",
    name: "explorer",
    triggers: [
      { event: "autonomy.queue.empty" },
      { event: "autonomy.queue.thin" },
    ],
    steps: [
      {
        type: "agent",
        id: "explore",
        agentName: "explorer",
        model: "claude-opus-4-7",
        effort: "xhigh",
      },
    ],
  }),
];

describe("formatTable", () => {
  it("produces a non-empty string with workflow names", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatTable(graph);
    expect(output).toContain("Workflow Graph");
    expect(output).toContain("dispatcher");
    expect(output).toContain("builder");
    expect(output).toContain("explorer");
  });

  it("shows event chain section", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatTable(graph);
    expect(output).toContain("Event Chain");
    expect(output).toContain("autonomy.queue.available");
  });

  it("shows agents section", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatTable(graph);
    expect(output).toContain("Agents");
    expect(output).toContain("builder — used by: builder");
    expect(output).toContain("explorer — used by: explorer");
  });

  it("shows step details including agent info", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatTable(graph);
    expect(output).toContain("[agent] build (builder, claude-opus-4-7) (conditional)");
  });

  it("shows manifest effect risk for tool steps", () => {
    const graph = assembleWorkflowGraph(
      [
        makeDef({
          repository: "read",
          name: "tool-workflow",
          steps: [
            {
              type: "tool",
              id: "send",
              tool: "http_request",
              input: { method: "POST", url: "https://example.invalid" },
            },
          ],
        }),
      ],
      {
        moduleManifests: [
          buildModuleCapabilityManifestProjection(
            "web-access",
            {
              schemaVersion: 1,
              capabilities: [
                {
                  id: "web-access.http",
                  description: "HTTP access.",
                  scope: "external",
                  scopePolicyHooks: ["external-effects"],
                },
              ],
              dataClasses: [],
              simulation: {
                support: "external-effects-blocked",
                blockedReasons: ["HTTP writes are blocked in trial mode."],
              },
            },
            {
              dependencies: [],
              tools: [
                {
                  name: "http_request",
                  description: "HTTP request",
                  effect: networkWriteEffect(),
                },
              ],
              effects: [],
              workflows: [],
              workflowTriggers: [],
              channels: [],
              skills: [],
              agents: [],
              commands: [],
              routes: [],
              controlRoutes: [],
              events: [],
              eventFlows: [],
              localClientNamespaces: [],
              hasDaemonClientFactory: false,
              setupRequirements: [],
              hasHealthCheck: false,
            },
          ),
        ],
      },
    );

    expect(formatTable(graph)).toContain("[tool] send (http_request, risk=moderate, trial=blocked)");
  });

  it("shows summary counts", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatTable(graph);
    expect(output).toContain("3 workflow(s)");
  });
});

describe("formatCompact", () => {
  it("produces one-line-per-workflow summary", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatCompact(graph);
    expect(output).toContain("dispatcher");
    expect(output).toContain("builder");
    expect(output).toContain("explorer");
    expect(output).toContain("3 workflow(s)");
  });

  it("shows agents column", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatCompact(graph);
    // builder workflow uses builder agent
    expect(output).toMatch(/builder\s+builder/);
  });
});

describe("formatDot", () => {
  it("produces valid DOT output", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatDot(graph);
    expect(output).toContain("digraph workflows {");
    expect(output).toContain("}");
  });

  it("includes workflow nodes", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatDot(graph);
    expect(output).toContain('"dispatcher"');
    expect(output).toContain('"builder"');
    expect(output).toContain('"explorer"');
  });

  it("includes event nodes as diamonds", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatDot(graph);
    expect(output).toContain('"autonomy.queue.available" [shape=diamond');
  });

  it("includes agent names in workflow labels", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatDot(graph);
    expect(output).toContain("builder\\n[builder]");
  });

  it("draws edges from events to consuming workflows", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatDot(graph);
    expect(output).toContain('"autonomy.queue.available" -> "builder"');
  });

  it("draws edges from workflows to emitted events", () => {
    const graph = assembleWorkflowGraph(SAMPLE_DEFS);
    const output = formatDot(graph);
    expect(output).toContain('"dispatcher" -> "autonomy.queue.available"');
  });
});

describe("empty graph", () => {
  it("formatTable handles empty graph", () => {
    const graph = assembleWorkflowGraph([]);
    const output = formatTable(graph);
    expect(output).toContain("0 workflow(s)");
  });

  it("formatCompact handles empty graph", () => {
    const graph = assembleWorkflowGraph([]);
    const output = formatCompact(graph);
    expect(output).toContain("0 workflow(s)");
  });

  it("formatDot handles empty graph", () => {
    const graph = assembleWorkflowGraph([]);
    const output = formatDot(graph);
    expect(output).toContain("digraph workflows {");
    expect(output).toContain("}");
  });
});
