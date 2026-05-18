/**
 * Coding-task scenario layout for the harness-parity module.
 *
 * A scenario is a self-contained directory under `scenarios/<id>/` containing:
 *   - `scenario.json` — typed `ScenarioSpecFile` (this module)
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

export type ScenarioSpecFile = {
  /** Stable scenario id; must match the directory name. */
  id: string;
  /** One-line human description surfaced in `harness-parity list`. */
  description: string;
  /** The prompt delivered verbatim to every harness. */
  prompt: string;
  verification: ScenarioVerification;
  /**
   * Files the verification command may write under the scenario working
   * directory for operator preview. Paths are normalized POSIX-relative paths.
   */
  previewArtifacts: readonly string[];
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

function parsePreviewArtifacts(
  raw: JsonValue | undefined,
  scenarioDir: string,
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ScenarioLoadError(
      scenarioDir,
      "previewArtifacts must be an array of normalized relative paths.",
    );
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    if (typeof value !== "string" || value.length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `previewArtifacts[${index}] must be a non-empty string.`,
      );
    }
    if (value.includes("\\")) {
      throw new ScenarioLoadError(
        scenarioDir,
        `previewArtifacts[${index}] must use POSIX "/" separators, got "${value}".`,
      );
    }
    if (value.includes("\0")) {
      throw new ScenarioLoadError(
        scenarioDir,
        `previewArtifacts[${index}] must not contain NUL bytes.`,
      );
    }
    if (posix.isAbsolute(value)) {
      throw new ScenarioLoadError(
        scenarioDir,
        `previewArtifacts[${index}] must be relative, got "${value}".`,
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
        `previewArtifacts[${index}] must be a bounded normalized relative path, got "${value}".`,
      );
    }
    if (seen.has(value)) {
      throw new ScenarioLoadError(
        scenarioDir,
        `previewArtifacts contains duplicate path "${value}".`,
      );
    }
    seen.add(value);
    paths.push(value);
  }
  return paths;
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
    if (typeof r[key] !== "string" || (r[key] as string).length === 0) {
      throw new ScenarioLoadError(
        scenarioDir,
        `missing required non-empty string field "${key}".`,
      );
    }
  }
  return {
    id: r.id as string,
    description: r.description as string,
    prompt: r.prompt as string,
    verification: parseVerification(r.verification, scenarioDir),
    previewArtifacts: parsePreviewArtifacts(r.previewArtifacts, scenarioDir),
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
