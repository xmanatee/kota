import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FixtureProvenanceError,
  loadFixture,
} from "./fixture.js";
import {
  DEFAULT_PRE_RUN_EXPECTATIONS,
  singleSpec,
  writeFixture,
} from "./fixture-test-support.js";

describe("loadFixture state and provenance", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a typed environment-state-audit predicate declaration", () => {
    writeFixture(root, "stateAudit", {
      id: "stateAudit",
      description: "x",
      role: "dispatcher",
      workflowName: "dispatcher",
      budgetMs: 60_000,
      predicates: [
        {
          kind: "environment-state-audit",
          files: [
            {
              path: ".kota/runs/fixture-dispatcher/emitted-events.jsonl",
              format: "jsonl",
              expectedEffects: [
                {
                  match: { event: "autonomy.queue.available" },
                  count: 1,
                },
              ],
              forbiddenEffects: [
                { match: { event: "autonomy.queue.empty" } },
              ],
            },
          ],
        },
      ],
    });
    const loaded = loadFixture(root, "stateAudit");
    expect(singleSpec(loaded).predicates).toEqual([
      {
        kind: "environment-state-audit",
        files: [
          {
            path: ".kota/runs/fixture-dispatcher/emitted-events.jsonl",
            format: "jsonl",
            expectedEffects: [
              {
                match: { event: "autonomy.queue.available" },
                count: 1,
              },
            ],
            forbiddenEffects: [
              { match: { event: "autonomy.queue.empty" } },
            ],
          },
        ],
      },
    ]);
  });

  it("rejects malformed environment-state-audit predicate declarations", () => {
    writeFixture(root, "badStateAudit", {
      id: "badStateAudit",
      description: "x",
      role: "dispatcher",
      workflowName: "dispatcher",
      budgetMs: 60_000,
      predicates: [
        {
          kind: "environment-state-audit",
          files: [
            {
              path: "../outside.json",
              format: "json-array",
              expectedEffects: [
                { match: { event: "autonomy.queue.available" }, count: 1 },
              ],
            },
          ],
        },
      ],
    });
    expect(() => loadFixture(root, "badStateAudit")).toThrow(/invalid predicate/);

    writeFixture(root, "badStateAuditCount", {
      id: "badStateAuditCount",
      description: "x",
      role: "dispatcher",
      workflowName: "dispatcher",
      budgetMs: 60_000,
      predicates: [
        {
          kind: "environment-state-audit",
          files: [
            {
              path: "state/events.json",
              format: "json-array",
              expectedEffects: [
                { match: { event: "autonomy.queue.available" }, count: 0 },
              ],
            },
          ],
        },
      ],
    });
    expect(() => loadFixture(root, "badStateAuditCount")).toThrow(
      /invalid predicate/,
    );
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
    expect(singleSpec(loaded).triggerPayload).toEqual({
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
});
