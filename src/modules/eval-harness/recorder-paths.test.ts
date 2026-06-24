import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  requireRecorderIdentifier,
  resolveRecordingFixtureDir,
} from "./recorder-paths.js";

describe("recorder path guards", () => {
  let fixturesRoot: string;

  beforeEach(() => {
    fixturesRoot = mkdtempSync(join(tmpdir(), "kota-recorder-fixtures-"));
  });

  afterEach(() => {
    rmSync(fixturesRoot, { recursive: true, force: true });
  });

  it("accepts existing fixture, run, step, and judge identifier shapes", () => {
    expect(requireRecorderIdentifier("builder-agent-call-replay", "--fixture")).toBe(
      "builder-agent-call-replay",
    );
    expect(
      requireRecorderIdentifier(
        "2026-04-24T00-00-00-000Z-builder-judge",
        "--run-id",
      ),
    ).toBe("2026-04-24T00-00-00-000Z-builder-judge");
    expect(requireRecorderIdentifier("critic-review", "--judge")).toBe(
      "critic-review",
    );
    expect(requireRecorderIdentifier("semantic.gate_review", "--step")).toBe(
      "semantic.gate_review",
    );
  });

  it("rejects unsafe fixture ids before resolving fixture paths", () => {
    for (const id of [
      "../outside",
      "nested/fixture",
      "nested\\fixture",
      "/tmp/fixture",
      "fixture with space",
    ]) {
      expect(() => resolveRecordingFixtureDir(fixturesRoot, id)).toThrow(
        /--fixture must be a safe single path component/,
      );
    }
  });

  it("rejects unsafe run, step, and judge ids with label-specific errors", () => {
    expect(() => requireRecorderIdentifier("../outside-run", "--run-id")).toThrow(
      /--run-id must be a safe single path component/,
    );
    expect(() => requireRecorderIdentifier("nested/step", "--step")).toThrow(
      /--step must be a safe single path component/,
    );
    expect(() => requireRecorderIdentifier("nested\\judge", "--judge")).toThrow(
      /--judge must be a safe single path component/,
    );
  });

  it("resolves safe fixture ids under the fixtures root", () => {
    expect(resolveRecordingFixtureDir(fixturesRoot, "builder-safe")).toBe(
      join(fixturesRoot, "builder-safe"),
    );
  });
});
