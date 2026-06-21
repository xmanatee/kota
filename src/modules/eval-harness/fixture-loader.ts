
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentStepRecording,
  AgentStepRecordingError,
  loadAgentStepRecordings,
  recordingsDirForFixture,
} from "./agent-step-recording.js";
import { FixtureRecordingProvenanceError } from "./fixture-errors.js";
import { parseFixtureSpec } from "./fixture-spec-parser.js";
import type { FixtureSpecFile, LoadedFixture } from "./fixture-spec-types.js";

function validateRecordingProvenance(
  fixtureDir: string,
  spec: FixtureSpecFile,
  recordings: readonly AgentStepRecording[],
): void {
  if (recordings.length === 0) return;
  // Real-failure fixtures pin every recording to the same source run id so
  // the recording is provable evidence of a past run rather than a synthesized
  // shape. Smoke fixtures opt out of that pin: they exist to lock harness
  // plumbing for a workflow whose target failure mode has no real-run history
  // yet, and a synthesized recording is the legitimate way to exercise that
  // plumbing. Honesty for smoke fixtures lives in the written
  // `justification`, which the loader already enforces is non-empty; the
  // recording's own `sourceRunId` field (also enforced non-empty by
  // `parseAgentStepRecording`) carries traceability for the recording's
  // origin without forcing a fake "real-failure" claim onto a synthesized
  // shape.
  if (spec.provenance.kind !== "real-failure") return;
  const expected = spec.provenance.sourceRunId;
  for (const recording of recordings) {
    if (recording.sourceRunId !== expected) {
      throw new FixtureRecordingProvenanceError(
        fixtureDir,
        `recording for step "${recording.stepId}" cites sourceRunId "${recording.sourceRunId}" but fixture provenance.sourceRunId is "${expected}".`,
      );
    }
  }
}

/**
 * Load a single fixture by id from the fixtures root. Fails loudly when the
 * directory layout is wrong — silent skips would hide eval coverage gaps.
 */
export function loadFixture(fixturesRoot: string, id: string): LoadedFixture {
  const fixtureDir = join(fixturesRoot, id);
  if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
    throw new Error(`Fixture "${id}" not found under "${fixturesRoot}".`);
  }
  const specPath = join(fixtureDir, "fixture.json");
  if (!existsSync(specPath)) {
    throw new Error(`Fixture "${id}" missing fixture.json at "${specPath}".`);
  }
  const spec = parseFixtureSpec(readFileSync(specPath, "utf-8"), fixtureDir);
  if (spec.id !== id) {
    throw new Error(
      `Fixture directory "${id}" has mismatched fixture.id="${spec.id}".`,
    );
  }
  const initialStateDir = join(fixtureDir, "initial");
  if (!existsSync(initialStateDir) || !statSync(initialStateDir).isDirectory()) {
    throw new Error(
      `Fixture "${id}" missing required initial/ directory at "${initialStateDir}".`,
    );
  }
  let agentStepRecordings: readonly AgentStepRecording[];
  try {
    agentStepRecordings = loadAgentStepRecordings(fixtureDir);
  } catch (err) {
    if (err instanceof AgentStepRecordingError) {
      throw new Error(
        `Fixture "${id}" has invalid agent-step recording (${recordingsDirForFixture(fixtureDir)}): ${err.message}`,
      );
    }
    throw err;
  }
  validateRecordingProvenance(fixtureDir, spec, agentStepRecordings);
  return { spec, fixtureDir, initialStateDir, agentStepRecordings };
}

/**
 * Load every fixture discoverable under the fixtures root. A fixture is any
 * subdirectory containing a fixture.json file; other entries are ignored so
 * operators can keep notes or helpers alongside fixtures without failing
 * discovery.
 */
export function loadAllFixtures(fixturesRoot: string): LoadedFixture[] {
  if (!existsSync(fixturesRoot)) return [];
  const entries = readdirSync(fixturesRoot, { withFileTypes: true });
  const fixtures: LoadedFixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = join(fixturesRoot, entry.name, "fixture.json");
    if (!existsSync(specPath)) continue;
    fixtures.push(loadFixture(fixturesRoot, entry.name));
  }
  return fixtures.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}
