import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixtureProvenanceError, loadAllFixtures, loadFixture } from "./fixture.js";

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
