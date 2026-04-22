import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadAllScenarios,
  loadScenario,
  ScenarioLoadError,
} from "./scenario.js";

function writeScenario(
  scenariosRoot: string,
  id: string,
  spec: Record<string, unknown>,
  initialFiles: Record<string, string> = {},
): string {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(join(dir, "scenario.json"), JSON.stringify(spec, null, 2));
  for (const [relPath, contents] of Object.entries(initialFiles)) {
    const fullPath = join(dir, "initial", relPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, contents);
  }
  return dir;
}

describe("scenario loader", () => {
  let scenariosRoot: string;
  beforeEach(() => {
    scenariosRoot = mkdtempSync(join(tmpdir(), "kota-harness-parity-scenarios-"));
  });
  afterEach(() => {
    rmSync(scenariosRoot, { recursive: true, force: true });
  });

  it("loads a well-formed scenario", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "demo",
        description: "demo scenario",
        prompt: "do the thing",
        verification: { command: "true", timeoutMs: 10_000 },
      },
      { "hello.txt": "hi" },
    );
    const loaded = loadScenario(scenariosRoot, "demo");
    expect(loaded.spec.id).toBe("demo");
    expect(loaded.spec.prompt).toBe("do the thing");
    expect(loaded.spec.verification.timeoutMs).toBe(10_000);
  });

  it("defaults verification.timeoutMs when omitted", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "demo",
        description: "demo scenario",
        prompt: "do the thing",
        verification: { command: "true" },
      },
      { "hello.txt": "hi" },
    );
    const loaded = loadScenario(scenariosRoot, "demo");
    expect(loaded.spec.verification.timeoutMs).toBe(60_000);
  });

  it("rejects an id mismatch between directory and scenario.json", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "other",
        description: "demo",
        prompt: "do the thing",
        verification: { command: "true" },
      },
      { "hello.txt": "hi" },
    );
    expect(() => loadScenario(scenariosRoot, "demo")).toThrow(ScenarioLoadError);
  });

  it("rejects missing verification object", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "demo",
        description: "demo",
        prompt: "do the thing",
      },
      { "hello.txt": "hi" },
    );
    expect(() => loadScenario(scenariosRoot, "demo")).toThrow(ScenarioLoadError);
  });

  it("rejects missing initial/ directory", () => {
    const dir = join(scenariosRoot, "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "scenario.json"),
      JSON.stringify({
        id: "demo",
        description: "demo",
        prompt: "do the thing",
        verification: { command: "true" },
      }),
    );
    expect(() => loadScenario(scenariosRoot, "demo")).toThrow(ScenarioLoadError);
  });

  it("loadAllScenarios returns scenarios sorted by id and skips non-scenario directories", () => {
    writeScenario(
      scenariosRoot,
      "b-second",
      {
        id: "b-second",
        description: "b",
        prompt: "b",
        verification: { command: "true" },
      },
      { "x.txt": "x" },
    );
    writeScenario(
      scenariosRoot,
      "a-first",
      {
        id: "a-first",
        description: "a",
        prompt: "a",
        verification: { command: "true" },
      },
      { "x.txt": "x" },
    );
    mkdirSync(join(scenariosRoot, "not-a-scenario"), { recursive: true });

    const all = loadAllScenarios(scenariosRoot);
    expect(all.map((s) => s.spec.id)).toEqual(["a-first", "b-second"]);
  });

  it("returns [] when scenariosRoot does not exist", () => {
    rmSync(scenariosRoot, { recursive: true, force: true });
    expect(loadAllScenarios(scenariosRoot)).toEqual([]);
  });
});
