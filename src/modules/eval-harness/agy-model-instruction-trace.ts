import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  KOTA_AGENT_COMMAND_TRACE_ALGORITHM,
  type KotaAgentCommandTrace,
  kotaAgentCommandTraceMatches,
} from "#core/agent-harness/index.js";
import {
  AGY_MODEL_EVALUATION_SCENARIOS,
  type AgyInstructionTraceRule,
} from "./agy-model-evaluation-types.js";
import type { FixtureRunReport } from "./runner.js";

type TraceJsonValue =
  | null
  | boolean
  | number
  | string
  | TraceJsonValue[]
  | { [key: string]: TraceJsonValue };

type TraceJsonObject = { [key: string]: TraceJsonValue };

type InstructionCheck = {
  passed: boolean;
  detail: string;
};

type TraceCommandEvidence = InstructionCheck & {
  commandTraces: readonly KotaAgentCommandTrace[];
};

export type AgyInstructionAdherenceEvaluation = {
  checks: readonly InstructionCheck[];
  detail: string;
};

const SHA256_DIGEST = /^[a-f0-9]{64}$/;

function isTraceJsonObject(value: TraceJsonValue): value is TraceJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: TraceJsonValue | undefined): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry): entry is string =>
        typeof entry === "string" && SHA256_DIGEST.test(entry),
    )
  ) {
    return null;
  }
  return value;
}

function decodeCommandTrace(
  value: TraceJsonValue | undefined,
): KotaAgentCommandTrace | null {
  if (value === undefined || !isTraceJsonObject(value)) return null;
  if (value.algorithm !== KOTA_AGENT_COMMAND_TRACE_ALGORITHM) return null;
  const exactDigests = stringArray(value.exactDigests);
  const prefixDigests = stringArray(value.prefixDigests);
  if (
    exactDigests === null ||
    prefixDigests === null ||
    exactDigests.length === 0 ||
    exactDigests.some((digest) => !prefixDigests.includes(digest))
  ) {
    return null;
  }
  return {
    algorithm: KOTA_AGENT_COMMAND_TRACE_ALGORITHM,
    exactDigests,
    prefixDigests,
  };
}

function workflowTraceDir(report: FixtureRunReport): InstructionCheck & {
  path: string | null;
} {
  const source = report.executionOutcome.runArtifactPath;
  if (source === null) {
    return {
      path: null,
      passed: false,
      detail: "workflow execution recorded no trace artifact path",
    };
  }
  const workingDir = resolve(report.workingDir);
  const traceDir = resolve(source);
  const relativeTrace = relative(workingDir, traceDir);
  if (
    relativeTrace === "" ||
    relativeTrace.startsWith("..") ||
    resolve(workingDir, relativeTrace) !== traceDir
  ) {
    return {
      path: null,
      passed: false,
      detail: `workflow trace escaped fixture working directory: ${source}`,
    };
  }
  if (!existsSync(traceDir) || !statSync(traceDir).isDirectory()) {
    return {
      path: null,
      passed: false,
      detail: `workflow trace directory is missing: ${relativeTrace}`,
    };
  }
  return {
    path: traceDir,
    passed: true,
    detail: `workflow trace directory is available: ${relativeTrace}`,
  };
}

function readTraceCommandEvidence(
  report: FixtureRunReport,
): TraceCommandEvidence {
  const trace = workflowTraceDir(report);
  if (!trace.passed || trace.path === null) {
    return { ...trace, commandTraces: [] };
  }
  const stepsDir = join(trace.path, "steps");
  if (!existsSync(stepsDir) || !statSync(stepsDir).isDirectory()) {
    return {
      passed: false,
      commandTraces: [],
      detail: "workflow trace has no steps directory",
    };
  }
  const eventFiles = readdirSync(stepsDir)
    .filter((name) => name.endsWith(".events.jsonl"))
    .sort();
  if (eventFiles.length === 0) {
    return {
      passed: false,
      commandTraces: [],
      detail: "workflow trace has no agent event stream",
    };
  }

  const commandTraces: KotaAgentCommandTrace[] = [];
  let eventCount = 0;
  const malformed: string[] = [];
  for (const eventFile of eventFiles) {
    const lines = readFileSync(join(stepsDir, eventFile), "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim() ?? "";
      if (line.length === 0) continue;
      try {
        const parsed = JSON.parse(line) as TraceJsonValue;
        if (!isTraceJsonObject(parsed)) {
          malformed.push(`${eventFile}:${index + 1} is not an object`);
          continue;
        }
        eventCount += 1;
        if (parsed.type === "status" && parsed.commandTrace !== undefined) {
          const commandTrace = decodeCommandTrace(parsed.commandTrace);
          if (commandTrace === null) {
            malformed.push(`${eventFile}:${index + 1} has an invalid command trace`);
          } else {
            commandTraces.push(commandTrace);
          }
        }
      } catch {
        malformed.push(`${eventFile}:${index + 1} is not valid JSON`);
      }
    }
  }
  if (eventCount === 0 || malformed.length > 0) {
    return {
      passed: false,
      commandTraces,
      detail:
        `workflow trace integrity failed (${eventCount} event(s), ` +
        `${malformed.length} malformed line(s)): ` +
        `${malformed.join(", ") || "no recorded events"}`,
    };
  }
  return {
    passed: true,
    commandTraces,
    detail:
      `inspected ${eventCount} recorded agent event(s) across ` +
      `${eventFiles.length} step trace(s); observed ` +
      `${commandTraces.length} safe command trace(s)`,
  };
}

function ruleMatched(
  rule: AgyInstructionTraceRule,
  commandTraces: readonly KotaAgentCommandTrace[],
): boolean {
  return commandTraces.some((trace) =>
    kotaAgentCommandTraceMatches(
      trace,
      rule.command,
      rule.kind === "required-command" ? "exact" : "prefix",
    )
  );
}

function evaluateTraceRule(
  rule: AgyInstructionTraceRule,
  commandTraces: readonly KotaAgentCommandTrace[],
): InstructionCheck {
  const matched = ruleMatched(rule, commandTraces);
  const passed = rule.kind === "required-command" ? matched : !matched;
  return {
    passed,
    detail:
      `${rule.kind} ${JSON.stringify(rule.command)} ` +
      `${passed ? "satisfied" : "violated"} ` +
      `(source: ${rule.sourcePath})`,
  };
}

export function evaluateAgyInstructionAdherence(
  report: FixtureRunReport,
): AgyInstructionAdherenceEvaluation {
  const deterministicChecks: InstructionCheck[] = [
    ...report.preRunExpectationResults.map((result) => ({
      passed: result.passed,
      detail: `pre-run expectation: ${result.detail}`,
    })),
    ...report.predicateResults.map((result) => ({
      passed: result.passed,
      detail: `final predicate ${result.predicate.kind}: ${result.detail}`,
    })),
  ];
  const scenario = AGY_MODEL_EVALUATION_SCENARIOS.find(
    (entry) => entry.fixtureId === report.run.fixtureId,
  );
  if (scenario === undefined) {
    const missingScenario = {
      passed: false,
      detail: `no AGY instruction policy for fixture ${report.run.fixtureId}`,
    };
    return {
      checks: [...deterministicChecks, missingScenario],
      detail: missingScenario.detail,
    };
  }
  const trace = readTraceCommandEvidence(report);
  const ruleChecks = scenario.instructionTraceRules.map((rule) =>
    evaluateTraceRule(rule, trace.commandTraces)
  );
  return {
    checks: [
      ...deterministicChecks,
      { passed: trace.passed, detail: trace.detail },
      ...ruleChecks,
    ],
    detail: [trace.detail, ...ruleChecks.map((check) => check.detail)].join("; "),
  };
}
