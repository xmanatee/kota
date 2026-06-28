import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScenarioAcrossHarnesses, runScenarioOnHarness } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, SHIPPED_SCENARIOS_ROOT, setupRunnerTestState, writePreviewArtifactScenario } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner preview artifacts", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("copies declared preview artifacts after verification and references them from run summaries", async () => {
    writePreviewArtifactScenario(
      scenariosRoot,
      "preview-capture",
      ["preview.html", "preview-check.json"],
      'const { writeFileSync } = require("node:fs");\n' +
        'writeFileSync("preview.html", "<!doctype html><p>visible preview</p>\\n");\n' +
        'writeFileSync("preview-check.json", JSON.stringify({ passed: true }, null, 2));\n' +
        'console.log("ok");\n',
    );
    const scenario = loadScenario(scenariosRoot, "preview-capture");
    const harness = makeHarness("previewing", () => {
      // The verifier owns preview artifact creation.
    });

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const artifact = artifacts[0]!;
    expect(artifact.previewArtifacts).toEqual([
      {
        sourcePath: "preview.html",
        artifactPath: join(artifact.artifactDir, "preview.html"),
        preserved: true,
      },
      {
        sourcePath: "preview-check.json",
        artifactPath: join(artifact.artifactDir, "preview-check.json"),
        preserved: true,
      },
    ]);
    expect(readFileSync(join(artifact.artifactDir, "preview.html"), "utf-8")).toContain(
      "visible preview",
    );

    const meta = JSON.parse(
      readFileSync(join(artifact.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(meta.previewArtifacts).toEqual(artifact.previewArtifacts);

    const summary = readFileSync(
      join(artifact.artifactDir, "trace-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("- previewArtifacts (2):");
    expect(summary).toContain("preview-check.json");

    const parity = JSON.parse(
      readFileSync(join(outRoot, "preview-capture", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].previewArtifacts).toEqual(artifact.previewArtifacts);
  });

  it("preserves preview artifacts for the shipped frontend-preview scenario", async () => {
    const scenario = loadScenario(SHIPPED_SCENARIOS_ROOT, "frontend-preview");
    const harness = makeHarness("previewing", (workingDir) => {
      const cssPath = join(workingDir, "styles.css");
      writeFileSync(
        cssPath,
        readFileSync(cssPath, "utf-8").replace("display: none;", "display: flex;"),
      );
    });
    const evidenceOutRoot = process.env.KOTA_HARNESS_PARITY_PREVIEW_EVIDENCE_DIR;
    const previewOutRoot = evidenceOutRoot ?? outRoot;
    if (evidenceOutRoot) {
      rmSync(evidenceOutRoot, { recursive: true, force: true });
    }

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: previewOutRoot,
    });

    const artifact = artifacts[0]!;
    expect(artifact.verification.passed).toBe(true);
    expect(artifact.changedFiles).toContain("styles.css");
    expect(artifact.previewArtifacts).toEqual([
      {
        sourcePath: "preview.html",
        artifactPath: join(artifact.artifactDir, "preview.html"),
        preserved: true,
      },
      {
        sourcePath: "preview-check.json",
        artifactPath: join(artifact.artifactDir, "preview-check.json"),
        preserved: true,
      },
    ]);
    expect(readFileSync(join(artifact.artifactDir, "preview.html"), "utf-8")).toContain(
      "Sync complete",
    );
    const previewCheck = JSON.parse(
      readFileSync(join(artifact.artifactDir, "preview-check.json"), "utf-8"),
    ) as { passed: boolean };
    expect(previewCheck.passed).toBe(true);

    const parity = JSON.parse(
      readFileSync(join(previewOutRoot, "frontend-preview", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].previewArtifacts).toEqual(artifact.previewArtifacts);
  });

  it("records missing declared preview artifacts without crashing the runner", async () => {
    writePreviewArtifactScenario(
      scenariosRoot,
      "missing-preview",
      ["missing.html"],
      'console.log("ok");\n',
    );
    const scenario = loadScenario(scenariosRoot, "missing-preview");
    const harness = makeHarness("previewing", () => {
      // no-op
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.previewArtifacts).toEqual([
      {
        sourcePath: "missing.html",
        artifactPath: join(artifact.artifactDir, "missing.html"),
        preserved: false,
        reason: "missing",
      },
    ]);
  });

  it("records non-file declared preview artifacts as invalid captures", async () => {
    writePreviewArtifactScenario(
      scenariosRoot,
      "bad-preview",
      ["preview.html"],
      'const { mkdirSync } = require("node:fs");\n' +
        'mkdirSync("preview.html");\n' +
        'console.log("ok");\n',
    );
    const scenario = loadScenario(scenariosRoot, "bad-preview");
    const harness = makeHarness("previewing", () => {
      // no-op
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.previewArtifacts).toEqual([
      {
        sourcePath: "preview.html",
        artifactPath: join(artifact.artifactDir, "preview.html"),
        preserved: false,
        reason: "not_file",
      },
    ]);
  });

  it("rejects symlinked declared preview artifacts", async () => {
    writePreviewArtifactScenario(
      scenariosRoot,
      "symlink-preview",
      ["preview.html"],
      'const { symlinkSync, writeFileSync } = require("node:fs");\n' +
        'writeFileSync("outside.html", "outside content\\n");\n' +
        'symlinkSync("outside.html", "preview.html");\n' +
        'console.log("ok");\n',
    );
    const scenario = loadScenario(scenariosRoot, "symlink-preview");
    const harness = makeHarness("previewing", () => {
      // no-op
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const artifactPath = join(artifact.artifactDir, "preview.html");
    expect(artifact.previewArtifacts).toEqual([
      {
        sourcePath: "preview.html",
        artifactPath,
        preserved: false,
        reason: "unsafe_path",
      },
    ]);
    expect(existsSync(artifactPath)).toBe(false);
  });

  it("rejects declared preview artifacts with a symlinked parent", async () => {
    writePreviewArtifactScenario(
      scenariosRoot,
      "symlink-parent-preview",
      ["linked/preview.html"],
      'const { mkdirSync, symlinkSync, writeFileSync } = require("node:fs");\n' +
        'mkdirSync("outside");\n' +
        'writeFileSync("outside/preview.html", "outside content\\n");\n' +
        'symlinkSync("outside", "linked");\n' +
        'console.log("ok");\n',
    );
    const scenario = loadScenario(scenariosRoot, "symlink-parent-preview");
    const harness = makeHarness("previewing", () => {
      // no-op
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const artifactPath = join(artifact.artifactDir, "linked", "preview.html");
    expect(artifact.previewArtifacts).toEqual([
      {
        sourcePath: "linked/preview.html",
        artifactPath,
        preserved: false,
        reason: "unsafe_path",
      },
    ]);
    expect(existsSync(artifactPath)).toBe(false);
  });
});
