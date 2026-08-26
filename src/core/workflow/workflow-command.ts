import {
  type ProcessCapture,
  type ProcessIdentity,
  ProcessSupervisor,
} from "#core/execution/process-supervisor.js";
import { buildWorkflowCommandEnv } from "./workflow-command-environment.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_CAPTURE_LIMIT_BYTES_PER_STREAM = 20_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const MAX_TIMER_MS = 2_147_483_647;

export type WorkflowCommandInput = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<NodeJS.ProcessEnv>;
  /** Replace inherited runtime environment with `env` for untrusted commands. */
  envMode?: "inherit" | "replace";
  stdin?: string;
  timeoutMs?: number;
  outputLimitBytes?: number;
  captureLimitBytesPerStream?: number;
  terminationGraceMs?: number;
  signal?: AbortSignal;
}>;

export type WorkflowCommandResult = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  identity: ProcessIdentity;
  exitCode: 0;
  stdout: ProcessCapture;
  stderr: ProcessCapture;
}>;

export type WorkflowCommandFailureKind =
  | "spawn-failed"
  | "failed"
  | "timed-out"
  | "output-limit";

type WorkflowCommandFailureDetails = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  identity: ProcessIdentity | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: ProcessCapture;
  stderr: ProcessCapture;
}>;

export class WorkflowCommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly identity: ProcessIdentity | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: ProcessCapture;
  readonly stderr: ProcessCapture;

  constructor(
    readonly kind: WorkflowCommandFailureKind,
    message: string,
    details: WorkflowCommandFailureDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkflowCommandError";
    this.command = details.command;
    this.args = details.args;
    this.cwd = details.cwd;
    this.identity = details.identity;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
  }
}

export type WorkflowCommandRunner = (
  input: WorkflowCommandInput,
) => Promise<WorkflowCommandResult>;

export type WorkflowCommandRunnerOptions = Readonly<{
  cwd: string;
  env?: Readonly<NodeJS.ProcessEnv>;
  signal?: AbortSignal;
  onProcessSpawn?: (identity: ProcessIdentity) => void;
}>;

type StopReason =
  | Readonly<{ kind: "cancelled"; signal: AbortSignal }>
  | Readonly<{ kind: "timed-out" }>
  | Readonly<{ kind: "output-limit" }>;

function assertPositiveInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
}

function displayArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

function displayCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(displayArgument).join(" ");
}

function displayCapture(capture: ProcessCapture): string {
  if (capture.text.length === 0) return "";
  if (!capture.truncated) return capture.text;
  const retainedBytes = Buffer.byteLength(capture.text);
  return `[... ${capture.totalBytes - retainedBytes} bytes truncated; showing tail ...]\n${capture.text}`;
}

function commandDiagnostic(stdout: ProcessCapture, stderr: ProcessCapture): string {
  return [displayCapture(stdout), displayCapture(stderr)]
    .filter((output) => output.length > 0)
    .join("\n");
}

function errorMessage(
  headline: string,
  stdout: ProcessCapture,
  stderr: ProcessCapture,
): string {
  const diagnostic = commandDiagnostic(stdout, stderr);
  return diagnostic.length > 0 ? `${headline}\n${diagnostic}` : headline;
}

function emptyCapture(): ProcessCapture {
  return { text: "", totalBytes: 0, truncated: false };
}

function cancellationError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(
    signal.reason === undefined ? "Workflow command cancelled" : String(signal.reason),
  );
  error.name = "AbortError";
  return error;
}

export function createWorkflowCommandRunner(
  options: WorkflowCommandRunnerOptions,
): WorkflowCommandRunner {
  return async (input): Promise<WorkflowCommandResult> => {
    if (input.command.length === 0) {
      throw new Error("Workflow command must not be empty");
    }
    const args = input.args ?? [];
    const cwd = input.cwd ?? options.cwd;
    const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const outputLimitBytes = input.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    const captureLimitBytesPerStream =
      input.captureLimitBytesPerStream ?? DEFAULT_CAPTURE_LIMIT_BYTES_PER_STREAM;
    const terminationGraceMs =
      input.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    assertPositiveInteger("timeoutMs", timeoutMs, MAX_TIMER_MS);
    assertPositiveInteger(
      "outputLimitBytes",
      outputLimitBytes,
      Number.MAX_SAFE_INTEGER,
    );

    const controller = new AbortController();
    let stopReason: StopReason | undefined;
    let outputBytes = 0;
    const stop = (reason: StopReason): void => {
      if (controller.signal.aborted) return;
      stopReason = reason;
      controller.abort();
    };
    const signals = [options.signal, input.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    const uniqueSignals = [...new Set(signals)];
    const abortListeners = uniqueSignals.map((signal) => {
      const listener = () => stop({ kind: "cancelled", signal });
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
      return { signal, listener };
    });
    const timeout = setTimeout(() => stop({ kind: "timed-out" }), timeoutMs);

    try {
      const supervisor = new ProcessSupervisor({
        command: input.command,
        args,
        cwd,
        env: buildWorkflowCommandEnv(
          cwd,
          input.envMode === "replace" ? undefined : options.env,
          input.env,
          input.envMode !== "replace",
        ),
        stdin: input.stdin,
        captureLimitBytesPerStream,
        terminationGraceMs,
        signal: controller.signal,
        onSpawn: options.onProcessSpawn,
        onOutput: ({ data }) => {
          outputBytes += Buffer.byteLength(data);
          if (outputBytes > outputLimitBytes) stop({ kind: "output-limit" });
        },
      });
      const outcome = await supervisor.run();
      const renderedCommand = displayCommand(input.command, args);

      if (stopReason?.kind === "cancelled") {
        throw cancellationError(stopReason.signal);
      }
      if (outcome.status === "spawn-failed") {
        const stdout = emptyCapture();
        const stderr = emptyCapture();
        throw new WorkflowCommandError(
          "spawn-failed",
          `Command could not start: ${renderedCommand}\n${outcome.error.message}`,
          {
            command: input.command,
            args,
            cwd,
            identity: null,
            exitCode: null,
            signal: null,
            stdout,
            stderr,
          },
        );
      }
      if (stopReason?.kind === "timed-out") {
        throw new WorkflowCommandError(
          "timed-out",
          errorMessage(
            `Command timed out after ${timeoutMs}ms: ${renderedCommand}`,
            outcome.stdout,
            outcome.stderr,
          ),
          {
            command: input.command,
            args,
            cwd,
            identity: outcome.identity,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
          },
        );
      }
      if (stopReason?.kind === "output-limit") {
        throw new WorkflowCommandError(
          "output-limit",
          errorMessage(
            `Command output exceeded ${outputLimitBytes} bytes: ${renderedCommand}`,
            outcome.stdout,
            outcome.stderr,
          ),
          {
            command: input.command,
            args,
            cwd,
            identity: outcome.identity,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
          },
        );
      }
      if (outcome.status === "aborted") {
        const error = new Error(`Command cancelled: ${renderedCommand}`);
        error.name = "AbortError";
        throw error;
      }
      if (outcome.exitCode !== 0 || outcome.signal !== null) {
        const disposition = outcome.exitCode === null
          ? `signal ${outcome.signal ?? "unknown"}`
          : `exit ${outcome.exitCode}`;
        throw new WorkflowCommandError(
          "failed",
          errorMessage(
            `Command failed (${disposition}): ${renderedCommand}`,
            outcome.stdout,
            outcome.stderr,
          ),
          {
            command: input.command,
            args,
            cwd,
            identity: outcome.identity,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
          },
        );
      }
      return {
        command: input.command,
        args,
        cwd,
        identity: outcome.identity,
        exitCode: 0,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      };
    } finally {
      clearTimeout(timeout);
      for (const { signal, listener } of abortListeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  };
}

export function workflowCommandOutput(result: WorkflowCommandResult): string {
  return [result.stdout.text, result.stderr.text]
    .filter((output) => output.length > 0)
    .join("\n");
}
