import { mkdtempSync, rmSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodeHealthDiagnosticsValidationError } from "./code-health-diagnostics.js";
import {
  loadFixture,
} from "./fixture.js";
import {
  writeFixture,
} from "./fixture-test-support.js";

describe("loadFixture diagnostics", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts typed code-health diagnostic declarations", () => {
    writeFixture(root, "withCodeHealth", {
      id: "withCodeHealth",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      codeHealthDiagnostics: {
        sourceGlobs: ["src/**/*.ts"],
        excludeGlobs: ["src/generated/**"],
        thresholds: {
          duplicateChunkLines: 3,
          duplicateChunkMinOccurrences: 2,
          maxLargestFileBytesShare: 0.8,
          maxLargestFunctionLines: 20,
        },
      },
    });

    const loaded = loadFixture(root, "withCodeHealth");
    expect(loaded.spec.codeHealthDiagnostics).toMatchObject({
      sourceGlobs: ["src/**/*.ts"],
      excludeGlobs: ["src/generated/**"],
      thresholds: {
        duplicateChunkLines: 3,
        maxLargestFileBytesShare: 0.8,
      },
    });
  });

  it("rejects malformed code-health diagnostic declarations", () => {
    writeFixture(root, "badCodeHealth", {
      id: "badCodeHealth",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      codeHealthDiagnostics: {
        sourceGlobs: ["../outside.ts"],
      },
    });

    let caught: unknown;
    try {
      loadFixture(root, "badCodeHealth");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodeHealthDiagnosticsValidationError);
    expect((caught as CodeHealthDiagnosticsValidationError).reason).toBe(
      "malformed-declaration",
    );
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
