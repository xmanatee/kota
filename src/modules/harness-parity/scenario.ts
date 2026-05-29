/**
 * Coding-task scenario layout for the harness-parity module.
 *
 * A scenario is a self-contained directory under `scenarios/<id>/` containing:
 *   - `scenario.json` — single-stage or staged metadata normalized by this module
 *   - `initial/` — initial working tree copied into the isolated run directory
 *
 * The same scenario is fed to every registered `AgentHarness` so the captured
 * artifacts are directly comparable. Verification inspects the final working
 * directory after the harness returns; the agent's self-report is never part
 * of the pass/fail signal.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const MAX_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60_000;
const STAGED_MIN_STAGE_COUNT = 2;
const STAGED_MAX_STAGE_COUNT = 3;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | JsonObject;

type JsonObject = {
  readonly [key: string]: JsonValue | undefined;
};

/**
 * Shell command whose exit status determines whether the scenario passed for a
 * given harness. Exit 0 = pass, any other status (or timeout) = fail. Runs in
 * the scenario's working directory after the harness returns.
 */
export type ScenarioVerification = {
  command: string;
  timeoutMs: number;
};

export type ScenarioContextRetrievalTarget =
  | {
      id: string;
      kind: "path";
      path: string;
    }
  | {
      id: string;
      kind: "glob";
      glob: string;
    }
  | {
      id: string;
      kind: "path-group";
      paths: readonly string[];
    }
  | {
      id: string;
      kind: "glob-group";
      globs: readonly string[];
    };

export type ScenarioContextRetrievalSpec = {
  targets: readonly ScenarioContextRetrievalTarget[];
};

export type ScenarioStageSpec = {
  /** Stable stage id used for per-stage artifact directories. */
  id: string;
  /** The prompt delivered verbatim for this stage. */
  prompt: string;
  verification: ScenarioVerification;
  /**
   * Files this stage's verification command may write under the scenario
   * working directory for operator preview.
   */
  previewArtifacts: readonly string[];
  /** Optional expected context targets this stage should discover before editing. */
  contextRetrieval?: ScenarioContextRetrievalSpec;
};

export type ScenarioSpecFile = {
  /** Stable scenario id; must match the directory name. */
  id: string;
  /** One-line human description surfaced in `harness-parity list`. */
  description: string;
  /** Backwards-compatible single prompt; staged scenarios expose the first stage prompt here. */
  prompt: string;
  /** Backwards-compatible verifier; staged scenarios expose the final stage verifier here. */
  verification: ScenarioVerification;
  /**
   * Files the verification command may write under the scenario working
   * directory for operator preview. Paths are normalized POSIX-relative paths.
   */
  previewArtifacts: readonly string[];
  /** Optional expected context targets for the single-stage scenario shape. */
  contextRetrieval?: ScenarioContextRetrievalSpec;
  /** Whether the source metadata was the original single-stage shape or staged. */
  stageMode: "single" | "staged";
  /** Ordered prompts and verifiers executed by the runner. */
  stages: readonly ScenarioStageSpec[];
};

export type LoadedScenario = {
  spec: ScenarioSpecFile;
  /** Absolute path to this scenario's directory under `scenarios/`. */
  scenarioDir: string;
  /** Absolute path to this scenario's `initial/` directory. */
  initialStateDir: string;
};

export class ScenarioLoadError extends Error {
  readonly scenarioDir: string;
  constructor(scenarioDir: string, reason: string) {
    super(`Scenario at "${scenarioDir}" is invalid: ${reason}`);
    this.name = "ScenarioLoadError";
    this.scenarioDir = scenarioDir;
  }
}

function requireJsonObject(value: unknown, scenarioDir: string, reason: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioLoadError(scenarioDir, reason);
  }
  return value as JsonObject;
}

function parseVerification(
  raw: JsonValue | undefined,
  scenarioDir: string,
): ScenarioVerification {
  const r = requireJsonObject(
    raw,
    scenarioDir,
    'missing verification object. Every scenario must declare verification.command (string).',
  );
  if (typeof r.command !== "string" || r.command.trim().length === 0) {
    throw new ScenarioLoadError(
      scenarioDir,
      'verification.command must be a non-empty string.',
    );
  }
  const timeoutMs =
    r.timeoutMs === undefined
      ? DEFAULT_TIMEOUT_MS
      : typeof r.timeoutMs === "number" && Number.isFinite(r.timeoutMs)
        ? r.timeoutMs
        : (() => {
            throw new ScenarioLoadError(
              scenarioDir,
              `verification.timeoutMs must be a finite number, got ${String(r.timeoutMs)}.`,
            );
          })();
  if (timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ScenarioLoadError(
      scenarioDir,
      `verification.timeoutMs=${timeoutMs} outside (0, ${MAX_TIMEOUT_MS}].`,
    );
  }
  return { command: r.command, timeoutMs };
}

function parseNormalizedRelativePath(
  value: string,
  scenarioDir: string,
  fieldName: string,
): string {
  if (value.includes("\\")) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName} must use POSIX "/" separators, got "${value}".`,
    );
  }
  if (value.includes("\0")) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName} must not contain NUL bytes.`,
    );
  }
  if (posix.isAbsolute(value)) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName} must be relative, got "${value}".`,
    );
  }
  const normalized = posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName} must be a bounded normalized relative path, got "${value}".`,
    );
  }
  return value;
}

function parsePreviewArtifacts(
  raw: JsonValue | undefined,
  scenarioDir: string,
  fieldName = "previewArtifacts",
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName} must be an array of normalized relative paths.`,
    );
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    if (typeof value !== "string" || value.length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `${fieldName}[${index}] must be a non-empty string.`,
      );
    }
    parseNormalizedRelativePath(value, scenarioDir, `${fieldName}[${index}]`);
    if (seen.has(value)) {
      throw new ScenarioLoadError(
        scenarioDir,
        `${fieldName} contains duplicate path "${value}".`,
      );
    }
    seen.add(value);
    paths.push(value);
  }
  return paths;
}

function parseNonEmptyPathList(
  raw: JsonValue | undefined,
  scenarioDir: string,
  fieldName: string,
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName} must be a non-empty array of normalized relative paths.`,
    );
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    if (typeof value !== "string" || value.length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `${fieldName}[${index}] must be a non-empty string.`,
      );
    }
    parseNormalizedRelativePath(value, scenarioDir, `${fieldName}[${index}]`);
    if (seen.has(value)) {
      throw new ScenarioLoadError(
        scenarioDir,
        `${fieldName} contains duplicate path "${value}".`,
      );
    }
    seen.add(value);
    paths.push(value);
  }
  return paths;
}

function parseContextRetrievalTargetId(
  raw: JsonValue | undefined,
  scenarioDir: string,
  fieldName: string,
): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName}.id must be a non-empty string.`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) {
    throw new ScenarioLoadError(
      scenarioDir,
      `${fieldName}.id must be a lowercase slug, got "${raw}".`,
    );
  }
  return raw;
}

function parseContextRetrievalTarget(
  raw: JsonValue | undefined,
  scenarioDir: string,
  index: number,
): ScenarioContextRetrievalTarget {
  const fieldName = `contextRetrieval.targets[${index}]`;
  const r = requireJsonObject(raw, scenarioDir, `${fieldName} must be an object.`);
  const id = parseContextRetrievalTargetId(r.id, scenarioDir, fieldName);
  if (r.kind === "path") {
    if (typeof r.path !== "string" || r.path.length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `${fieldName}.path must be a non-empty string.`,
      );
    }
    return {
      id,
      kind: "path",
      path: parseNormalizedRelativePath(r.path, scenarioDir, `${fieldName}.path`),
    };
  }
  if (r.kind === "glob") {
    if (typeof r.glob !== "string" || r.glob.length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `${fieldName}.glob must be a non-empty string.`,
      );
    }
    return {
      id,
      kind: "glob",
      glob: parseNormalizedRelativePath(r.glob, scenarioDir, `${fieldName}.glob`),
    };
  }
  if (r.kind === "path-group") {
    return {
      id,
      kind: "path-group",
      paths: parseNonEmptyPathList(r.paths, scenarioDir, `${fieldName}.paths`),
    };
  }
  if (r.kind === "glob-group") {
    return {
      id,
      kind: "glob-group",
      globs: parseNonEmptyPathList(r.globs, scenarioDir, `${fieldName}.globs`),
    };
  }
  throw new ScenarioLoadError(
    scenarioDir,
    `${fieldName}.kind must be one of path, glob, path-group, or glob-group.`,
  );
}

function parseContextRetrievalSpec(
  raw: JsonValue | undefined,
  scenarioDir: string,
): ScenarioContextRetrievalSpec | undefined {
  if (raw === undefined) return undefined;
  const r = requireJsonObject(
    raw,
    scenarioDir,
    "contextRetrieval must be an object.",
  );
  if (!Array.isArray(r.targets) || r.targets.length === 0) {
    throw new ScenarioLoadError(
      scenarioDir,
      "contextRetrieval.targets must be a non-empty array.",
    );
  }
  const targets = r.targets.map((target, index) =>
    parseContextRetrievalTarget(target, scenarioDir, index),
  );
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) {
      throw new ScenarioLoadError(
        scenarioDir,
        `contextRetrieval.targets contains duplicate id "${target.id}".`,
      );
    }
    seen.add(target.id);
  }
  return { targets };
}

function parseStageId(
  raw: JsonValue | undefined,
  scenarioDir: string,
  index: number,
): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ScenarioLoadError(
      scenarioDir,
      `stages[${index}].id must be a non-empty string.`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) {
    throw new ScenarioLoadError(
      scenarioDir,
      `stages[${index}].id must be a lowercase slug, got "${raw}".`,
    );
  }
  return raw;
}

function parseStage(
  raw: JsonValue | undefined,
  scenarioDir: string,
  index: number,
): ScenarioStageSpec {
  const r = requireJsonObject(raw, scenarioDir, `stages[${index}] must be an object.`);
  const id = parseStageId(r.id, scenarioDir, index);
  if (typeof r.prompt !== "string" || r.prompt.length === 0) {
    throw new ScenarioLoadError(
      scenarioDir,
      `stages[${index}].prompt must be a non-empty string.`,
    );
  }
  const contextRetrieval = parseContextRetrievalSpec(
    r.contextRetrieval,
    scenarioDir,
  );
  return {
    id,
    prompt: r.prompt,
    verification: parseVerification(r.verification, scenarioDir),
    previewArtifacts: parsePreviewArtifacts(
      r.previewArtifacts,
      scenarioDir,
      `stages[${index}].previewArtifacts`,
    ),
    ...(contextRetrieval !== undefined ? { contextRetrieval } : {}),
  };
}

function parseStages(
  raw: JsonValue | undefined,
  scenarioDir: string,
): ScenarioStageSpec[] {
  if (!Array.isArray(raw)) {
    throw new ScenarioLoadError(
      scenarioDir,
      "stages must be an array of two or three stage objects.",
    );
  }
  if (
    raw.length < STAGED_MIN_STAGE_COUNT ||
    raw.length > STAGED_MAX_STAGE_COUNT
  ) {
    throw new ScenarioLoadError(
      scenarioDir,
      `staged scenarios must declare ${STAGED_MIN_STAGE_COUNT}-${STAGED_MAX_STAGE_COUNT} stages, got ${raw.length}.`,
    );
  }

  const stages = raw.map((stage, index) => parseStage(stage, scenarioDir, index));
  const seen = new Set<string>();
  for (const stage of stages) {
    if (seen.has(stage.id)) {
      throw new ScenarioLoadError(
        scenarioDir,
        `stages contains duplicate id "${stage.id}".`,
      );
    }
    seen.add(stage.id);
  }
  return stages;
}

function parseScenarioSpec(rawJson: string, scenarioDir: string): ScenarioSpecFile {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (err) {
    throw new ScenarioLoadError(
      scenarioDir,
      `unparseable scenario.json: ${(err as Error).message}`,
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ScenarioLoadError(
      scenarioDir,
      "scenario.json must be a JSON object.",
    );
  }
  const r = requireJsonObject(
    raw,
    scenarioDir,
    "scenario.json must be a JSON object.",
  );
  for (const key of ["id", "description", "prompt"] as const) {
    if (key === "prompt" && r.stages !== undefined) continue;
    if (typeof r[key] !== "string" || (r[key] as string).length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `missing required non-empty string field "${key}".`,
      );
    }
  }

  if (r.stages !== undefined) {
    if (r.prompt !== undefined || r.verification !== undefined) {
      throw new ScenarioLoadError(
        scenarioDir,
        "staged scenarios must declare stages instead of top-level prompt or verification.",
      );
    }
    if (r.previewArtifacts !== undefined) {
      throw new ScenarioLoadError(
        scenarioDir,
        "staged scenarios must declare previewArtifacts on each stage, not at the top level.",
      );
    }
    if (r.contextRetrieval !== undefined) {
      throw new ScenarioLoadError(
        scenarioDir,
        "staged scenarios must declare contextRetrieval on each stage, not at the top level.",
      );
    }
    const stages = parseStages(r.stages, scenarioDir);
    const firstStage = stages[0]!;
    const finalStage = stages[stages.length - 1]!;
    return {
      id: r.id as string,
      description: r.description as string,
      prompt: firstStage.prompt,
      verification: finalStage.verification,
      previewArtifacts: [],
      stageMode: "staged",
      stages,
    };
  }

  if (r.verification === undefined) {
    throw new ScenarioLoadError(
      scenarioDir,
      'missing verification object. Every scenario must declare verification.command (string).',
    );
  }
  const prompt = r.prompt as string;
  const verification = parseVerification(r.verification, scenarioDir);
  const previewArtifacts = parsePreviewArtifacts(r.previewArtifacts, scenarioDir);
  const contextRetrieval = parseContextRetrievalSpec(
    r.contextRetrieval,
    scenarioDir,
  );
  return {
    id: r.id as string,
    description: r.description as string,
    prompt,
    verification,
    previewArtifacts,
    ...(contextRetrieval !== undefined ? { contextRetrieval } : {}),
    stageMode: "single",
    stages: [
      {
        id: "main",
        prompt,
        verification,
        previewArtifacts,
        ...(contextRetrieval !== undefined ? { contextRetrieval } : {}),
      },
    ],
  };
}

export function loadScenario(scenariosRoot: string, id: string): LoadedScenario {
  const scenarioDir = join(scenariosRoot, id);
  if (!existsSync(scenarioDir) || !statSync(scenarioDir).isDirectory()) {
    throw new ScenarioLoadError(scenarioDir, `scenario directory not found.`);
  }
  const specPath = join(scenarioDir, "scenario.json");
  if (!existsSync(specPath)) {
    throw new ScenarioLoadError(scenarioDir, `missing scenario.json at "${specPath}".`);
  }
  const spec = parseScenarioSpec(readFileSync(specPath, "utf-8"), scenarioDir);
  if (spec.id !== id) {
    throw new ScenarioLoadError(
      scenarioDir,
      `directory name "${id}" does not match scenario.id="${spec.id}".`,
    );
  }
  const initialStateDir = join(scenarioDir, "initial");
  if (!existsSync(initialStateDir) || !statSync(initialStateDir).isDirectory()) {
    throw new ScenarioLoadError(
      scenarioDir,
      `missing required initial/ directory at "${initialStateDir}".`,
    );
  }
  return { spec, scenarioDir, initialStateDir };
}

export function loadAllScenarios(scenariosRoot: string): LoadedScenario[] {
  if (!existsSync(scenariosRoot)) return [];
  const entries = readdirSync(scenariosRoot, { withFileTypes: true });
  const scenarios: LoadedScenario[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = join(scenariosRoot, entry.name, "scenario.json");
    if (!existsSync(specPath)) continue;
    scenarios.push(loadScenario(scenariosRoot, entry.name));
  }
  return scenarios.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}
