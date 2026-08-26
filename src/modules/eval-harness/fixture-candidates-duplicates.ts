import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { resolveKotaRuntimeAsset } from "#core/util/kota-install-paths.js";
import { REPO_TASK_STATES } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  isJsonObject,
  parseString,
  readJsonValue,
} from "./fixture-candidates-json.js";
import type {
  DuplicateCoverage,
  FixtureCandidateDuplicateReference,
} from "./fixture-candidates-types.js";

const RUN_REFERENCE = /\.kota\/runs\/([A-Za-z0-9_.:-]+)\//g;
const CANDIDATE_FINGERPRINT =
  /<!-- fixture-candidate-fingerprint: ([A-Za-z0-9:_.-]+) -->/g;

function parseFixtureProvenance(path: string): { sourceRunId: string | null; id: string } {
  const raw = readJsonValue(path);
  if (!isJsonObject(raw)) return { sourceRunId: null, id: basename(path) };
  const id = parseString(raw.id) ?? basename(path);
  const provenance = raw.provenance;
  if (!isJsonObject(provenance)) return { sourceRunId: null, id };
  const kind = parseString(provenance.kind);
  const sourceRunId = parseString(provenance.sourceRunId);
  return {
    id,
    sourceRunId: kind === "real-failure" && sourceRunId !== undefined
      ? sourceRunId
      : null,
  };
}

export function collectDuplicateCoverage(projectDir: string): DuplicateCoverage {
  const fixtureRoot = resolveKotaRuntimeAsset(
    "src/modules/eval-harness/fixtures",
  );
  const byRun = new Map<string, string[]>();
  if (existsSync(fixtureRoot)) {
    for (const entry of readdirSync(fixtureRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fixturePath = join(fixtureRoot, entry.name, "fixture.json");
      if (!existsSync(fixturePath)) continue;
      const provenance = parseFixtureProvenance(fixturePath);
      if (provenance.sourceRunId === null) continue;
      const fixtures = byRun.get(provenance.sourceRunId) ?? [];
      fixtures.push(provenance.id);
      byRun.set(provenance.sourceRunId, fixtures.sort());
    }
  }
  const taskReferencesByRunId = new Map<string, FixtureCandidateDuplicateReference[]>();
  const taskReferencesByFingerprint = new Map<string, FixtureCandidateDuplicateReference[]>();
  collectTaskDuplicateCoverage(
    projectDir,
    taskReferencesByRunId,
    taskReferencesByFingerprint,
  );
  return {
    coveredRunIds: byRun,
    taskReferencesByRunId,
    taskReferencesByFingerprint,
  };
}

function pushDuplicateReference(
  target: Map<string, FixtureCandidateDuplicateReference[]>,
  key: string,
  reference: FixtureCandidateDuplicateReference,
): void {
  const existing = target.get(key) ?? [];
  if (!existing.some((entry) => entry.id === reference.id && entry.path === reference.path)) {
    existing.push(reference);
  }
  target.set(
    key,
    existing.sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id)),
  );
}

function collectTaskDuplicateCoverage(
  projectDir: string,
  taskReferencesByRunId: Map<string, FixtureCandidateDuplicateReference[]>,
  taskReferencesByFingerprint: Map<string, FixtureCandidateDuplicateReference[]>,
): void {
  const tasksDir = join(projectDir, "data", "tasks");
  for (const state of REPO_TASK_STATES) {
    const stateDir = join(tasksDir, state);
    if (!existsSync(stateDir)) continue;
    for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "AGENTS.md") {
        continue;
      }
      const id = basename(entry.name, ".md");
      const path = join(stateDir, entry.name);
      const content = readFileSync(path, "utf-8");
      const reference: FixtureCandidateDuplicateReference = {
        kind: "task",
        id,
        path: relative(projectDir, path),
        state,
        reason: "task already references this trace-derived eval candidate evidence",
      };
      for (const match of content.matchAll(RUN_REFERENCE)) {
        pushDuplicateReference(taskReferencesByRunId, match[1], reference);
      }
      for (const match of content.matchAll(CANDIDATE_FINGERPRINT)) {
        pushDuplicateReference(
          taskReferencesByFingerprint,
          match[1],
          reference,
        );
      }
    }
  }
}
