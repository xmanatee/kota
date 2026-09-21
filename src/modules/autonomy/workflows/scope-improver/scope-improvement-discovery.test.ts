import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { collectScopeImprovementInputs } from "./scope-improvement-discovery.js";
import { emptyScopeImprovementState } from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

describe("scope improvement guidance containment", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "kota-guidance-containment-"));
    roots.push(root);
    const scope = join(root, "scope");
    const outside = join(root, "outside");
    mkdirSync(scope);
    mkdirSync(outside);
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      writeFileSync(join(outside, name), "SYNTHETIC_OUTSIDE_GUIDANCE_DO_NOT_COLLECT");
    }
    const collect = (evidenceRefs: string[] = [], automatic = false) => collectScopeImprovementInputs({
      workspaceRoot: scope,
      state: emptyScopeImprovementState(deriveDirectoryScopeId(scope)),
      scopePolicySnapshot: scopePolicySnapshotForTest(scope),
      now: new Date("2026-09-21T00:00:00Z"),
      trigger: { event: "autonomy.scope-improvement.requested", schemaRef: null,
        payload: { boundary: "initial-onboarding", evidenceRefs, automatic } },
    });
    return { scope, outside, collect };
  }

  it.each(["AGENTS.md", "CLAUDE.md"])("rejects automatic root %s symlinks without returning collected inputs", (name) => {
    const { scope, outside, collect } = fixture();
    symlinkSync(join(outside, name), join(scope, name));
    expect(() => collect([], true)).toThrow(/Unsafe filesystem path/);
  });

  it("rejects evidence-derived guidance through a linked ancestor", () => {
    const { scope, outside, collect } = fixture();
    mkdirSync(join(scope, "plans"));
    symlinkSync(outside, join(scope, "plans", "linked"));
    expect(() => collect(["plans/linked/trip.md"])).toThrow(/Unsafe filesystem path/);
  });

  it.each(["AGENTS.md", "CLAUDE.md"])("rejects an evidence-derived %s leaf link", (name) => {
    const { scope, outside, collect } = fixture();
    mkdirSync(join(scope, "plans"));
    symlinkSync(join(outside, name), join(scope, "plans", name));
    expect(() => collect(["plans/trip.md"])).toThrow(/Unsafe filesystem path/);
  });

  it.each(["../outside/trip.md", "plans/../../outside/trip.md", "plans/../trip.md", "/outside/trip.md", "C:\\outside\\trip.md"])(
    "retains citation %s without using it to select guidance", (ref) => {
      const { scope, collect } = fixture();
      writeFileSync(join(scope, "AGENTS.md"), "Contained root guidance");
      const inputs = collect([ref]);
      expect(inputs.semanticInput.evidenceRefs).toEqual([ref]);
      expect(inputs.instructions).toEqual([{ path: "AGENTS.md", excerpt: "Contained root guidance" }]);
      expect(JSON.stringify(inputs)).not.toContain("SYNTHETIC_OUTSIDE_GUIDANCE_DO_NOT_COLLECT");
    },
  );

  it("rejects multiply linked guidance during fingerprint collection", () => {
    const { scope, outside, collect } = fixture();
    linkSync(join(outside, "AGENTS.md"), join(scope, "AGENTS.md"));
    expect(() => collect([], true)).toThrow(/Unsafe filesystem path/);
  });

  it.each([false, true])("retains contained root and nested guidance, with missing guidance optional (automatic: %s)", (automatic) => {
    const { scope, collect } = fixture();
    writeFileSync(join(scope, "AGENTS.md"), "  Root guidance  \n");
    mkdirSync(join(scope, "plans"));
    writeFileSync(join(scope, "plans", "CLAUDE.md"), `Nested guidance ${"x".repeat(900)}`);
    const inputs = collect(["plans/trip.md", "missing/file.md"], automatic);
    expect(inputs.instructions).toEqual([
      { path: "AGENTS.md", excerpt: "Root guidance" },
      { path: "plans/CLAUDE.md", excerpt: `Nested guidance ${"x".repeat(900)}`.slice(0, 800) },
    ]);
    expect(inputs.evidence.filter((item) => item.kind === "instruction").map((item) => item.path))
      .toEqual(["AGENTS.md", "plans/CLAUDE.md"]);
    expect(JSON.stringify(inputs)).not.toContain("SYNTHETIC_OUTSIDE_GUIDANCE_DO_NOT_COLLECT");
  });
});
