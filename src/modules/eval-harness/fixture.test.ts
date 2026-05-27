import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FixtureProvenanceError,
  FixtureRecordingProvenanceError,
  loadAllFixtures,
  loadFixture,
} from "./fixture.js";
import { ObjectiveMetricValidationError } from "./objective-metrics.js";
import { evaluatePredicateExpectations } from "./predicates.js";

const REAL_FAILURE_PROVENANCE = {
  kind: "real-failure",
  sourceRunId: "2026-04-01T00-00-00-000Z-builder-abcdef",
};

const SMOKE_PROVENANCE = {
  kind: "smoke-fixture",
  justification: "Exists to prove harness plumbing itself still works.",
};

const DEFAULT_PRE_RUN_EXPECTATIONS = [
  { predicate: { kind: "file-exists", path: "foo" }, expected: "fail" },
];

function writeFixture(
  root: string,
  id: string,
  spec: Record<string, unknown>,
  withInitial = true,
): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const withProvenance =
    spec.provenance === undefined
      ? { ...spec, provenance: REAL_FAILURE_PROVENANCE }
      : spec;
  const withControlDecisions =
    withProvenance.controlDecisions === undefined
      ? { ...withProvenance, controlDecisions: ["act"] }
      : withProvenance;
  const fullSpec =
    withControlDecisions.preRunExpectations === undefined
      ? {
          ...withControlDecisions,
          preRunExpectations: DEFAULT_PRE_RUN_EXPECTATIONS,
        }
      : withControlDecisions;
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fullSpec, null, 2));
  if (withInitial) mkdirSync(join(dir, "initial"));
}

describe("loadFixture", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads a well-formed real-failure fixture", () => {
    writeFixture(root, "example", {
      id: "example",
      description: "example",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      tags: ["smoke"],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    const loaded = loadFixture(root, "example");
    expect(loaded.spec.id).toBe("example");
    expect(loaded.spec.predicates).toHaveLength(1);
    expect(loaded.spec.preRunExpectations).toEqual(DEFAULT_PRE_RUN_EXPECTATIONS);
    expect(loaded.spec.tags).toEqual(["smoke"]);
    expect(loaded.spec.provenance).toEqual(REAL_FAILURE_PROVENANCE);
    expect(loaded.spec.controlDecisions).toEqual(["act"]);
  });

  it("loads a well-formed smoke fixture with justification", () => {
    writeFixture(root, "smokey", {
      id: "smokey",
      description: "smokey",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      provenance: SMOKE_PROVENANCE,
    });
    const loaded = loadFixture(root, "smokey");
    expect(loaded.spec.provenance).toEqual(SMOKE_PROVENANCE);
  });

  it("fails when id mismatches the directory name", () => {
    writeFixture(root, "expected", {
      id: "other",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
    });
    expect(() => loadFixture(root, "expected")).toThrow(/mismatched fixture.id/);
  });

  it("fails when predicates are empty", () => {
    writeFixture(root, "x", {
      id: "x",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [],
    });
    expect(() => loadFixture(root, "x")).toThrow(/at least one predicate/);
  });

  it("rejects a fixture that omits pre-run expectations", () => {
    const id = "missingPreRun";
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "fixture.json"),
      JSON.stringify({
        id,
        description: "x",
        role: "builder",
        workflowName: "builder",
        budgetMs: 600_000,
        predicates: [{ kind: "file-exists", path: "foo" }],
        provenance: REAL_FAILURE_PROVENANCE,
      }),
    );
    mkdirSync(join(dir, "initial"));
    expect(() => loadFixture(root, id)).toThrow(/preRunExpectations/);
  });

  it("rejects pre-run expectations without an initially failing predicate", () => {
    writeFixture(root, "vacuous", {
      id: "vacuous",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      preRunExpectations: [
        { predicate: { kind: "file-exists", path: "foo" }, expected: "pass" },
      ],
    });
    expect(() => loadFixture(root, "vacuous")).toThrow(/expected to fail initially/);
  });

  it("rejects a fixture that omits controlDecisions", () => {
    const id = "missingControl";
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "fixture.json"),
      JSON.stringify({
        id,
        description: "x",
        role: "builder",
        workflowName: "builder",
        budgetMs: 600_000,
        predicates: [{ kind: "file-exists", path: "foo" }],
        preRunExpectations: DEFAULT_PRE_RUN_EXPECTATIONS,
        provenance: REAL_FAILURE_PROVENANCE,
      }),
    );
    mkdirSync(join(dir, "initial"));
    expect(() => loadFixture(root, id)).toThrow(/controlDecisions/);
  });

  it("rejects empty, unknown, and duplicate controlDecisions", () => {
    writeFixture(root, "emptyControl", {
      id: "emptyControl",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      controlDecisions: [],
    });
    expect(() => loadFixture(root, "emptyControl")).toThrow(/controlDecisions/);

    writeFixture(root, "unknownControl", {
      id: "unknownControl",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      controlDecisions: ["patch"],
    });
    expect(() => loadFixture(root, "unknownControl")).toThrow(
      /invalid controlDecisions entry/,
    );

    writeFixture(root, "duplicateControl", {
      id: "duplicateControl",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      controlDecisions: ["act", "act"],
    });
    expect(() => loadFixture(root, "duplicateControl")).toThrow(
      /duplicate controlDecisions/,
    );
  });

  it("rejects malformed pre-run expectation entries", () => {
    writeFixture(root, "badPreRun", {
      id: "badPreRun",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      preRunExpectations: [
        { predicate: { kind: "not-a-kind", path: "foo" }, expected: "fail" },
      ],
    });
    expect(() => loadFixture(root, "badPreRun")).toThrow(
      /invalid preRunExpectations/,
    );
  });

  it("fails when budgetMs is missing or out of range", () => {
    writeFixture(root, "tooSmall", {
      id: "tooSmall",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 100,
      predicates: [{ kind: "file-exists", path: "foo" }],
    });
    expect(() => loadFixture(root, "tooSmall")).toThrow(/outside/);
  });

  it("fails when initial/ is missing — no silent skip", () => {
    writeFixture(
      root,
      "noInitial",
      {
        id: "noInitial",
        description: "x",
        role: "builder",
        workflowName: "builder",
        budgetMs: 600_000,
        predicates: [{ kind: "file-exists", path: "foo" }],
      },
      false,
    );
    expect(() => loadFixture(root, "noInitial")).toThrow(/initial\//);
  });

  it("rejects unknown predicate kinds", () => {
    writeFixture(root, "bad", {
      id: "bad",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "not-a-kind", path: "foo" }],
    });
    expect(() => loadFixture(root, "bad")).toThrow(/invalid predicate/);
  });

  it("rejects a fixture that omits provenance", () => {
    const id = "missingProvenance";
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "fixture.json"),
      JSON.stringify({
        id,
        description: "x",
        role: "builder",
        workflowName: "builder",
        budgetMs: 600_000,
        predicates: [{ kind: "file-exists", path: "foo" }],
        preRunExpectations: DEFAULT_PRE_RUN_EXPECTATIONS,
      }),
    );
    mkdirSync(join(dir, "initial"));
    let caught: unknown;
    try {
      loadFixture(root, id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureProvenanceError);
    expect((caught as FixtureProvenanceError).fixtureDir).toBe(dir);
    expect((caught as FixtureProvenanceError).message).toMatch(/missing provenance/);
  });

  it("rejects a smoke fixture without a written justification", () => {
    writeFixture(root, "smokeBare", {
      id: "smokeBare",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      provenance: { kind: "smoke-fixture", justification: "   " },
    });
    let caught: unknown;
    try {
      loadFixture(root, "smokeBare");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureProvenanceError);
    expect((caught as FixtureProvenanceError).message).toMatch(/justification/);
  });

  it("rejects a real-failure provenance without a sourceRunId", () => {
    writeFixture(root, "realBare", {
      id: "realBare",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      provenance: { kind: "real-failure" },
    });
    expect(() => loadFixture(root, "realBare")).toThrow(FixtureProvenanceError);
  });

  it("accepts an optional triggerPayload and forwards it verbatim", () => {
    writeFixture(root, "withPayload", {
      id: "withPayload",
      description: "x",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      triggerPayload: {
        runDir: ".kota/runs/fake-builder-run",
        runId: "fake-builder-run",
        nested: { count: 3 },
      },
    });
    const loaded = loadFixture(root, "withPayload");
    expect(loaded.spec.triggerPayload).toEqual({
      runDir: ".kota/runs/fake-builder-run",
      runId: "fake-builder-run",
      nested: { count: 3 },
    });
  });

  it("rejects a non-object triggerPayload", () => {
    writeFixture(root, "badPayload", {
      id: "badPayload",
      description: "x",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      triggerPayload: ["not", "an", "object"],
    });
    expect(() => loadFixture(root, "badPayload")).toThrow(/triggerPayload.*JSON object/);
  });

  it("accepts an optional externalCallShims list and validates entry shape", () => {
    writeFixture(root, "withShims", {
      id: "withShims",
      description: "x",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      externalCallShims: ["gh"],
    });
    const loaded = loadFixture(root, "withShims");
    expect(loaded.spec.externalCallShims).toEqual(["gh"]);
  });

  it("rejects externalCallShims entries with unsafe characters", () => {
    writeFixture(root, "badShims", {
      id: "badShims",
      description: "x",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      externalCallShims: ["../escape"],
    });
    expect(() => loadFixture(root, "badShims")).toThrow(/externalCallShims/);
  });

  it("accepts typed objective metric declarations", () => {
    writeFixture(root, "withMetric", {
      id: "withMetric",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      objectiveMetrics: [
        {
          name: "output_size",
          unit: "bytes",
          direction: "lower_is_better",
          source: {
            kind: "json-file",
            path: "metrics.json",
            pointer: "/output/bytes",
          },
          comparisonBaseline: {
            value: 120,
            resourceProfile: {
              cpuAllocationCores: 2,
              cpuKillThresholdCores: 2,
              memoryAllocationMB: 4000,
              memoryKillThresholdMB: 4000,
              hostClass: "test",
            },
            executionProfile: {
              status: "verified",
              backendKind: "container",
              verification: "enforced",
              gateEligible: true,
            },
          },
        },
      ],
    });
    const loaded = loadFixture(root, "withMetric");
    expect(loaded.spec.objectiveMetrics).toEqual([
      {
        name: "output_size",
        unit: "bytes",
        direction: "lower_is_better",
        source: {
          kind: "json-file",
          path: "metrics.json",
          pointer: "/output/bytes",
        },
        comparisonBaseline: {
          value: 120,
          resourceProfile: {
            cpuAllocationCores: 2,
            cpuKillThresholdCores: 2,
            memoryAllocationMB: 4000,
            memoryKillThresholdMB: 4000,
            hostClass: "test",
          },
          executionProfile: {
            status: "verified",
            backendKind: "container",
            verification: "enforced",
            gateEligible: true,
          },
        },
      },
    ]);
  });

  it("rejects malformed objective metric declarations with a typed validation error", () => {
    writeFixture(root, "badMetric", {
      id: "badMetric",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      objectiveMetrics: [
        {
          name: "bad metric",
          unit: "bytes",
          direction: "lower",
          source: { kind: "text-file", path: "metric.txt" },
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "badMetric");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ObjectiveMetricValidationError);
    expect((caught as ObjectiveMetricValidationError).reason).toBe(
      "malformed-declaration",
    );
  });

  it("rejects objective metric baselines without comparable environment data", () => {
    writeFixture(root, "badMetricBaseline", {
      id: "badMetricBaseline",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      objectiveMetrics: [
        {
          name: "duration",
          unit: "ms",
          direction: "lower_is_better",
          source: { kind: "text-file", path: "metric.txt" },
          comparisonBaseline: {
            value: 10,
            resourceProfile: {
              cpuAllocationCores: 2,
              cpuKillThresholdCores: 2,
              memoryAllocationMB: 4000,
              memoryKillThresholdMB: 4000,
              hostClass: "test",
            },
            executionProfile: {
              status: "non-gating",
              backendKind: "host-subprocess",
              verification: "unverified",
              gateEligible: false,
            },
          },
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "badMetricBaseline");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ObjectiveMetricValidationError);
    expect((caught as ObjectiveMetricValidationError).reason).toBe(
      "environment-incomparable",
    );
  });

  it("accepts a well-formed external-call-log predicate", () => {
    writeFixture(root, "withExtCall", {
      id: "withExtCall",
      description: "x",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [
        {
          kind: "external-call-log",
          binary: "gh",
          match: { kind: "argv-prefix", argv: ["pr", "review"] },
          exitClass: "zero",
        },
      ],
    });
    const loaded = loadFixture(root, "withExtCall");
    expect(loaded.spec.predicates).toHaveLength(1);
  });

  it("rejects an external-call-log predicate with a malformed match", () => {
    writeFixture(root, "badExtCall", {
      id: "badExtCall",
      description: "x",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [
        {
          kind: "external-call-log",
          binary: "gh",
          match: { kind: "argv-prefix", argv: [] },
        },
      ],
    });
    expect(() => loadFixture(root, "badExtCall")).toThrow(/invalid predicate/);
  });

  it("rejects unknown provenance kinds", () => {
    writeFixture(root, "unknownKind", {
      id: "unknownKind",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      provenance: { kind: "fallback" },
    });
    expect(() => loadFixture(root, "unknownKind")).toThrow(/Legal shapes are/);
  });
});

describe("loadAllFixtures", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-all-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns an empty list when the fixtures root does not exist", () => {
    rmSync(root, { recursive: true });
    expect(loadAllFixtures(root)).toEqual([]);
  });

  it("discovers multiple fixtures and returns them sorted by id", () => {
    writeFixture(root, "beta", {
      id: "beta",
      description: "beta",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
    });
    writeFixture(root, "alpha", {
      id: "alpha",
      description: "alpha",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
    });
    mkdirSync(join(root, "not-a-fixture"));
    writeFileSync(join(root, "note.md"), "ignore me");
    const ids = loadAllFixtures(root).map((f) => f.spec.id);
    expect(ids).toEqual(["alpha", "beta"]);
  });

  it("loads every shipped fixture with explicit pre-run expectations and control decisions", () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    expect(fixtures.length).toBeGreaterThan(0);
    expect(
      fixtures.every((fixture) =>
        fixture.spec.preRunExpectations.some(
          (expectation) => expectation.expected === "fail",
        ),
      ),
    ).toBe(true);
    expect(
      fixtures.every((fixture) => fixture.spec.controlDecisions.length > 0),
    ).toBe(true);
  });

  it("ships at least one smoke fixture with an objective metric and non-vacuous pre-run expectation", () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    const demonstratingFixtures = fixtures.filter(
      (fixture) =>
        fixture.spec.provenance.kind === "smoke-fixture" &&
        (fixture.spec.objectiveMetrics?.length ?? 0) > 0 &&
        fixture.spec.preRunExpectations.some(
          (expectation) => expectation.expected === "fail",
        ),
    );
    expect(demonstratingFixtures.map((fixture) => fixture.spec.id)).toContain(
      "builder-trivial-edit",
    );
  });

  it("shipped fixture pre-run expectations match their initial trees", () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    const scratch = mkdtempSync(join(tmpdir(), "kota-shipped-pre-run-"));
    try {
      for (const fixture of fixtures) {
        const workDir = join(scratch, fixture.spec.id);
        cpSync(fixture.initialStateDir, workDir, { recursive: true });
        const result = evaluatePredicateExpectations(
          workDir,
          fixture.spec.preRunExpectations,
        );
        expect(
          result.results.filter((entry) => !entry.passed),
          fixture.spec.id,
        ).toEqual([]);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("agent-step recording provenance", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-fixture-recording-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRecording(
    fixtureId: string,
    stepId: string,
    recording: Record<string, unknown>,
  ): void {
    const dir = join(root, fixtureId, "recordings");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${stepId}.json`),
      JSON.stringify(recording, null, 2),
    );
  }

  const VALID_RECORDING = {
    version: 1,
    workflowName: "decomposer",
    stepId: "decompose",
    sourceRunId: REAL_FAILURE_PROVENANCE.sourceRunId,
    response: {
      text: "ok",
      subtype: "success",
      turns: 1,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    fileOperations: [],
  };

  it("attaches recordings to the loaded fixture", () => {
    writeFixture(root, "withRec", {
      id: "withRec",
      description: "rec",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    writeRecording("withRec", "decompose", VALID_RECORDING);

    const loaded = loadFixture(root, "withRec");
    expect(loaded.agentStepRecordings).toHaveLength(1);
    expect(loaded.agentStepRecordings[0].stepId).toBe("decompose");
  });

  it("rejects a recording whose sourceRunId does not match provenance", () => {
    writeFixture(root, "mismatched", {
      id: "mismatched",
      description: "rec",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    writeRecording("mismatched", "decompose", {
      ...VALID_RECORDING,
      sourceRunId: "2026-04-02T00-00-00-000Z-other",
    });

    let caught: unknown;
    try {
      loadFixture(root, "mismatched");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureRecordingProvenanceError);
    expect((caught as Error).message).toMatch(/sourceRunId/);
  });

  it("permits agent-step recordings on a smoke fixture for harness-plumbing fixtures with no real-run history", () => {
    // Some workflows (e.g. pr-reviewer) have no real-failure history yet, so
    // the harness-plumbing fixture that locks their replay path must use
    // smoke-fixture provenance. Honesty stays in the smoke justification,
    // not in a forced "real-failure" claim against a fabricated run id.
    writeFixture(root, "smokeWithRec", {
      id: "smokeWithRec",
      description: "rec",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: SMOKE_PROVENANCE,
    });
    writeRecording("smokeWithRec", "decompose", {
      ...VALID_RECORDING,
      sourceRunId: "synthesized-fixture-2026-04-25",
    });

    const loaded = loadFixture(root, "smokeWithRec");
    expect(loaded.agentStepRecordings).toHaveLength(1);
    expect(loaded.agentStepRecordings[0].sourceRunId).toBe(
      "synthesized-fixture-2026-04-25",
    );
  });

  it("surfaces malformed recordings as a load-time error", () => {
    writeFixture(root, "malformed", {
      id: "malformed",
      description: "rec",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
      provenance: REAL_FAILURE_PROVENANCE,
    });
    writeRecording("malformed", "decompose", { version: 99 });

    expect(() => loadFixture(root, "malformed")).toThrow(/invalid agent-step recording/);
  });
});
