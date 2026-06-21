import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadFixture,
} from "./fixture.js";
import {
  DEFAULT_PRE_RUN_EXPECTATIONS,
  REAL_FAILURE_PROVENANCE,
  SMOKE_PROVENANCE,
  singleSpec,
  writeFixture,
} from "./fixture-test-support.js";

describe("loadFixture basics", () => {
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
    const spec = singleSpec(loaded);
    expect(spec.id).toBe("example");
    expect(spec.mode).toBe("single-workflow");
    expect(spec.predicates).toHaveLength(1);
    expect(spec.preRunExpectations).toEqual(DEFAULT_PRE_RUN_EXPECTATIONS);
    expect(spec.tags).toEqual(["smoke"]);
    expect(spec.provenance).toEqual(REAL_FAILURE_PROVENANCE);
    expect(spec.controlDecisions).toEqual(["act"]);
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
        controlDecisions: ["act"],
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
});
