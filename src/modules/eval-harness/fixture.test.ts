import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FixtureProvenanceError,
  FixtureRecordingProvenanceError,
  loadAllFixtures,
  loadFixture,
} from "./fixture.js";

const REAL_FAILURE_PROVENANCE = {
  kind: "real-failure",
  sourceRunId: "2026-04-01T00-00-00-000Z-builder-abcdef",
};

const SMOKE_PROVENANCE = {
  kind: "smoke-fixture",
  justification: "Exists to prove harness plumbing itself still works.",
};

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
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(withProvenance, null, 2));
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
    expect(loaded.spec.tags).toEqual(["smoke"]);
    expect(loaded.spec.provenance).toEqual(REAL_FAILURE_PROVENANCE);
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
