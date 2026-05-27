import { spawnSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export type TaskProbe = {
  command: string;
  timeoutMs: number;
};

export type TaskProbeResult = {
  verdict: "pass" | "fail";
  exitCode: number;
  durationMs: number;
  output: string;
  probe: TaskProbe;
};

const PROBE_SECTION_RE = /(?:^|\n)## +Runtime Probe\s*\n([\s\S]*?)(?=\n## |\n?$)/;
const CODE_FENCE_RE = /^\s*```[\w]*\n([\s\S]*?)\n```/;
const DEFAULT_PROBE_TIMEOUT_MS = 120_000;
const MAX_PROBE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_PROBE_OUTPUT_CHARS = 20_000;
const PROBE_MAX_BUFFER = 10 * 1024 * 1024;

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

  const timeoutRaw = attrs.timeoutMs;
  const timeoutMs = timeoutRaw === undefined
    ? DEFAULT_PROBE_TIMEOUT_MS
    : Number.parseInt(timeoutRaw, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Runtime Probe timeoutMs must be a positive integer (got "${timeoutRaw}").`,
    );
  }
  if (timeoutMs > MAX_PROBE_TIMEOUT_MS) {
    throw new Error(
      `Runtime Probe timeoutMs ${timeoutMs} exceeds the cap of ${MAX_PROBE_TIMEOUT_MS} ms.`,
    );
  }

  const recognized = new Set(["command", "timeoutMs"]);
  for (const key of Object.keys(attrs)) {
    if (!recognized.has(key)) {
      throw new Error(`Runtime Probe section has unknown field "${key}".`);
    }
  }

  return { command, timeoutMs };
}

function stripCodeFence(section: string): string {
  const fenced = section.match(CODE_FENCE_RE);
  return fenced ? fenced[1] : section;
}

export function runTaskProbe(probe: TaskProbe, projectDir: string): TaskProbeResult {
  const start = Date.now();
  const result = spawnSync(probe.command, {
    shell: true,
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    timeout: probe.timeoutMs,
    encoding: "utf-8",
    maxBuffer: PROBE_MAX_BUFFER,
  });
  const durationMs = Date.now() - start;
  const combined = [result.stdout ?? "", result.stderr ?? ""]
    .filter((part) => part.length > 0)
    .join("\n");
  const output = truncateTail(combined, MAX_PROBE_OUTPUT_CHARS);
  const exitCode = result.status ?? -1;
  const verdict: "pass" | "fail" = exitCode === 0 ? "pass" : "fail";
  return { verdict, exitCode, durationMs, output, probe };
}

function truncateTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated — showing tail ...]\n${text.slice(-limit)}`;
}

export function formatProbeBlock(result: TaskProbeResult): string {
  const lines = [
    "## Runtime Probe Result",
    `Command: ${result.probe.command}`,
    `Verdict: ${result.verdict}`,
    `Exit code: ${result.exitCode}`,
    `Duration: ${result.durationMs} ms`,
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
