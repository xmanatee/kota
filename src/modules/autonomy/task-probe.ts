import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import { parseConstrainedProbeCommand } from "./task-probe-command.js";

export { runTaskProbe } from "./task-probe-runner.js";

export type TaskProbe = {
  command: string;
  executable: "pnpm";
  args: string[];
  timeoutMs: number;
};

export type TaskProbeProvenance =
  | {
      status: "trusted";
      kind: "git-head";
      sourcePath: string;
    }
  | {
      status: "untrusted";
      reason: string;
    };

export type TaskProbeResult = {
  verdict: "pass" | "fail";
  exitCode: number;
  durationMs: number;
  output: string;
  probe: TaskProbe;
  execution: "os-contained-command" | "not-executed";
  isolation?:
    | {
        status: "enforced";
        kind: "linux-bubblewrap";
        processBoundary: "pid-namespace";
        evidence: string;
      }
    | {
        status: "unavailable";
        reason: string;
      };
  provenance?: TaskProbeProvenance;
};

const PROBE_SECTION_RE = /(?:^|\n)## +Runtime Probe\s*\n([\s\S]*?)(?=\n## |\n?$)/;
const CODE_FENCE_RE = /^\s*```[\w]*\n([\s\S]*?)\n```/;
const DEFAULT_PROBE_TIMEOUT_MS = 120_000;
const TRUSTED_PROBE_TASK_STATES = ["ready", "doing", "blocked", "done", "backlog"] as const;

export function extractTaskProbe(taskContent: string): TaskProbe | null {
  const sectionMatch = taskContent.match(PROBE_SECTION_RE);
  if (!sectionMatch) return null;

  const rawSection = stripCodeFence(sectionMatch[1]);
  const attrs: Record<string, string> = {};
  for (const line of rawSection.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 1) {
      throw new Error(
        `Runtime Probe section contains a line without "key: value": ${line}`,
      );
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!key || !value) {
      throw new Error(
        `Runtime Probe section has an empty key or value: ${line}`,
      );
    }
    if (attrs[key] !== undefined) {
      throw new Error(`Runtime Probe section declares "${key}" more than once.`);
    }
    attrs[key] = value;
  }

  const command = attrs.command;
  if (!command) {
    throw new Error(
      `Runtime Probe section is missing required "command" field.`,
    );
  }

  const parsed = parseConstrainedProbeCommand(command);
  const timeoutRaw = attrs.timeoutMs;
  const timeoutMs = timeoutRaw === undefined
    ? DEFAULT_PROBE_TIMEOUT_MS
    : Number(timeoutRaw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Runtime Probe timeoutMs must be a positive integer (got "${timeoutRaw}").`,
    );
  }
  if (timeoutMs > parsed.maxTimeoutMs) {
    throw new Error(
      `Runtime Probe timeoutMs ${timeoutMs} exceeds the cap of ${parsed.maxTimeoutMs} ms for this command.`,
    );
  }

  const recognized = new Set(["command", "timeoutMs"]);
  for (const key of Object.keys(attrs)) {
    if (!recognized.has(key)) {
      throw new Error(`Runtime Probe section has unknown field "${key}".`);
    }
  }

  return {
    command,
    executable: parsed.executable,
    args: parsed.args,
    timeoutMs,
  };
}

function stripCodeFence(section: string): string {
  const fenced = section.match(CODE_FENCE_RE);
  return fenced ? fenced[1] : section;
}

export function verifyTaskProbeProvenance(args: {
  projectDir: string;
  taskPath: string;
  probe: TaskProbe;
}): TaskProbeProvenance {
  const filename = basename(args.taskPath);
  for (const state of TRUSTED_PROBE_TASK_STATES) {
    const sourcePath = `data/tasks/${state}/${filename}`;
    const sourceContent = readHeadFile(args.projectDir, sourcePath);
    if (sourceContent === null) continue;

    const sourceProbe = extractTaskProbe(sourceContent);
    if (!sourceProbe) {
      return {
        status: "untrusted",
        reason: `Runtime Probe is absent from trusted pre-run task source ${sourcePath}.`,
      };
    }
    if (!sameProbeDeclaration(sourceProbe, args.probe)) {
      return {
        status: "untrusted",
        reason: `Runtime Probe declaration differs from trusted pre-run task source ${sourcePath}.`,
      };
    }
    return {
      status: "trusted",
      kind: "git-head",
      sourcePath,
    };
  }

  return {
    status: "untrusted",
    reason:
      "Runtime Probe declaration has no matching task file in git HEAD; current-run task text is not trusted provenance.",
  };
}

export function rejectedTaskProbeResult(
  probe: TaskProbe,
  reason: string,
): TaskProbeResult {
  return {
    verdict: "fail",
    exitCode: -1,
    durationMs: 0,
    output: `Runtime Probe not executed: ${reason}`,
    probe,
    execution: "not-executed",
    provenance: {
      status: "untrusted",
      reason,
    },
  };
}

function readHeadFile(projectDir: string, relPath: string): string | null {
  const result = spawnSync("git", ["show", `HEAD:${relPath}`], {
    cwd: projectDir,
    env: buildRequiredInheritedSubprocessEnv(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return result.stdout ?? "";
}

function sameProbeDeclaration(left: TaskProbe, right: TaskProbe): boolean {
  return (
    left.executable === right.executable &&
    left.timeoutMs === right.timeoutMs &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  );
}

export function formatProbeBlock(result: TaskProbeResult): string {
  const lines = [
    "## Runtime Probe Result",
    `Command: ${result.probe.command}`,
    `Execution: ${result.execution}`,
    ...(result.isolation
      ? [
          `Isolation: ${result.isolation.status}` +
            (result.isolation.status === "enforced"
              ? ` (${result.isolation.kind}, process boundary ${result.isolation.processBoundary}: ${result.isolation.evidence})`
              : ` (${result.isolation.reason})`),
        ]
      : []),
    `Verdict: ${result.verdict}`,
    `Exit code: ${result.exitCode}`,
    `Duration: ${result.durationMs} ms`,
    ...(result.provenance
      ? [
          `Provenance: ${result.provenance.status}` +
            (result.provenance.status === "trusted"
              ? ` (${result.provenance.sourcePath})`
              : ` (${result.provenance.reason})`),
        ]
      : []),
    "",
    "Treat a failed probe as a critical issue unless the probe itself is miscalibrated",
    "(e.g., an environmental failure unrelated to the staged change). The probe is the",
    "task author's declared success predicate for runtime behavior that the diff alone",
    "cannot prove.",
    "",
    "Output:",
    result.output.length > 0 ? result.output : "[no output]",
  ];
  return lines.join("\n");
}
