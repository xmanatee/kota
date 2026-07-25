import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SCIENTIFIC_CLAIM_ANALYZER_PATH as ANALYZER_PATH,
  HOLDOUT_CLAIM_EXPECTED as HOLDOUT_EXPECTED,
  MAIN_CLAIM_EXPECTED as MAIN_EXPECTED,
  VERIFIER_CLAIM_CSV as VERIFIER_CSV,
  VERIFIER_CLAIM_EXPECTED as VERIFIER_EXPECTED,
  validateScientificClaimArtifactFile as validateArtifactFile,
} from "./scientific-claim-artifact.js";

/**
 * Fixture-owned scientific claim scorer. Trusted code validates submitted
 * artifacts, then executes the candidate analyzer against the declared inputs
 * and verifier-only data in a permission-restricted temporary directory.
 */
export type ScientificClaimResultPredicate = {
  kind: "lx12-scientific-claim-result";
  mainPath: string;
  holdoutPath: string;
  maxErrorPct: number;
};

export type ScientificClaimPredicateEvaluation = {
  passed: boolean;
  detail: string;
};

const ANALYZER_MAX_BYTES = 256 * 1024;
const DATA_MAX_BYTES = 1024 * 1024;
const ANALYZER_TIMEOUT_MS = 15_000;
const OUTPUT_TAIL_LIMIT = 4_000;

function tail(text: string): string {
  if (text.length <= OUTPUT_TAIL_LIMIT) return text;
  return `[... ${text.length - OUTPUT_TAIL_LIMIT} chars truncated ...]\n${text.slice(-OUTPUT_TAIL_LIMIT)}`;
}

type CandidateFileRead =
  | { ok: true; content: string }
  | { ok: false; issue: string };

function readCandidateFile(
  workingDir: string,
  path: string,
  label: string,
  maxBytes: number,
): CandidateFileRead {
  const absolute = join(workingDir, path);
  if (!existsSync(absolute)) return { ok: false, issue: `${label}: ${path} is missing` };
  const file = lstatSync(absolute);
  if (!file.isFile()) {
    return { ok: false, issue: `${label}: ${path} must be a regular file` };
  }
  if (file.size > maxBytes) {
    return { ok: false, issue: `${label}: ${path} exceeds ${maxBytes} bytes` };
  }
  return { ok: true, content: readFileSync(absolute, "utf-8") };
}

function verifyAnalyzerExecution(
  workingDir: string,
  tolerance: number,
): string[] {
  const analyzer = readCandidateFile(
    workingDir,
    ANALYZER_PATH,
    "analyzer command",
    ANALYZER_MAX_BYTES,
  );
  if (!analyzer.ok) return [analyzer.issue];
  const mainData = readCandidateFile(
    workingDir,
    MAIN_EXPECTED.dataPath,
    "main command input",
    DATA_MAX_BYTES,
  );
  if (!mainData.ok) return [mainData.issue];
  const holdoutData = readCandidateFile(
    workingDir,
    HOLDOUT_EXPECTED.dataPath,
    "holdout command input",
    DATA_MAX_BYTES,
  );
  if (!holdoutData.ok) return [holdoutData.issue];
  const commandCases = [
    {
      expected: MAIN_EXPECTED,
      content: mainData.content,
      label: "main command artifact",
    },
    {
      expected: HOLDOUT_EXPECTED,
      content: holdoutData.content,
      label: "holdout command artifact",
    },
    {
      expected: VERIFIER_EXPECTED,
      content: VERIFIER_CSV,
      label: "verifier artifact",
    },
  ] as const;

  const challengeDir = realpathSync(
    mkdtempSync(join(tmpdir(), "kota-lx12-verifier-")),
  );
  try {
    mkdirSync(join(challengeDir, "scripts"), { recursive: true });
    mkdirSync(join(challengeDir, "data", "claims"), { recursive: true });
    writeFileSync(
      join(challengeDir, ANALYZER_PATH),
      analyzer.content,
      { encoding: "utf-8", mode: 0o400 },
    );
    for (const commandCase of commandCases) {
      writeFileSync(
        join(challengeDir, commandCase.expected.dataPath),
        commandCase.content,
        { encoding: "utf-8", mode: 0o400 },
      );
    }

    const issues: string[] = [];
    for (const commandCase of commandCases) {
      const output = join(challengeDir, commandCase.expected.outputPath);
      const result = spawnSync(
        process.execPath,
        [
          "--permission",
          `--allow-fs-read=${join(challengeDir, ANALYZER_PATH)}`,
          `--allow-fs-read=${join(challengeDir, commandCase.expected.dataPath)}`,
          `--allow-fs-write=${output}`,
          ANALYZER_PATH,
          "--data",
          commandCase.expected.dataPath,
          "--output",
          commandCase.expected.outputPath,
        ],
        {
          cwd: challengeDir,
          encoding: "utf-8",
          env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
          maxBuffer: 4 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: ANALYZER_TIMEOUT_MS,
        },
      );
      if (result.status !== 0 || result.error !== undefined) {
        const combined = [result.stdout, result.stderr, result.error?.message]
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          )
          .join("\n")
          .trim();
        const status =
          result.signal !== null
            ? `did not complete (${result.signal})`
            : `exited ${result.status ?? "without a status"}`;
        issues.push(
          `${commandCase.label}: analyzer command ${status}${
            combined.length > 0 ? `:\n${tail(combined)}` : ""
          }`,
        );
        continue;
      }
      issues.push(
        ...validateArtifactFile(
          challengeDir,
          commandCase.expected,
          tolerance,
          commandCase.label,
        ),
      );
    }
    return issues;
  } finally {
    rmSync(challengeDir, { recursive: true, force: true });
  }
}

export function evaluateScientificClaimResult(
  workingDir: string,
  predicate: ScientificClaimResultPredicate,
): ScientificClaimPredicateEvaluation {
  const issues: string[] = [];
  if (!Number.isFinite(predicate.maxErrorPct) || predicate.maxErrorPct < 0) {
    issues.push(`maxErrorPct must be a non-negative number, got ${predicate.maxErrorPct}`);
  }
  if (predicate.mainPath !== MAIN_EXPECTED.outputPath) {
    issues.push(`mainPath must be ${MAIN_EXPECTED.outputPath}`);
  }
  if (predicate.holdoutPath !== HOLDOUT_EXPECTED.outputPath) {
    issues.push(`holdoutPath must be ${HOLDOUT_EXPECTED.outputPath}`);
  }
  issues.push(
    ...validateArtifactFile(workingDir, MAIN_EXPECTED, predicate.maxErrorPct, "main artifact"),
    ...validateArtifactFile(workingDir, HOLDOUT_EXPECTED, predicate.maxErrorPct, "holdout artifact"),
  );
  if (issues.length === 0) {
    issues.push(...verifyAnalyzerExecution(workingDir, predicate.maxErrorPct));
  }

  return {
    passed: issues.length === 0,
    detail:
      issues.length === 0
        ? `lx12-scientific-claim-result verified ${predicate.mainPath}, ${predicate.holdoutPath}, both declared analyzer commands, and a permission-restricted command against verifier-only data`
        : `lx12-scientific-claim-result failed:\n- ${issues.join("\n- ")}`,
  };
}
