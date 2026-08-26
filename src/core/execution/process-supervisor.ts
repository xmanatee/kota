import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const MAX_TIMER_MS = 2_147_483_647;
const PROCESS_POLL_MS = 20;

export type ProcessStream = "stdout" | "stderr";

export type ProcessOutputEvent = Readonly<{
  stream: ProcessStream;
  data: string;
}>;

export type ProcessCapture = Readonly<{
  text: string;
  totalBytes: number;
  truncated: boolean;
}>;

/** Durable identity used to prove ownership before signalling a persisted process. */
export type ProcessIdentity = Readonly<{
  pid: number;
  processGroupId: number;
  /** Diagnostic snapshot only; an in-place exec may legitimately change it. */
  observedCommandHash: string;
  osStartToken: string;
}>;

export type ProcessSpawnObserver = (identity: ProcessIdentity) => void;

export type ProcessVerification =
  | Readonly<{ status: "owned"; observed: ProcessIdentity }>
  | Readonly<{ status: "not-running" }>
  | Readonly<{ status: "identity-mismatch"; observed: ProcessIdentity }>;

export type ProcessTerminationOutcome =
  | Readonly<{ status: "terminated"; escalated: boolean }>
  | Readonly<{ status: "still-running"; escalated: true }>
  | Readonly<{ status: "not-running"; escalated: false }>
  | Readonly<{
      status: "identity-mismatch";
      escalated: false;
      observed: ProcessIdentity;
    }>;

export type ProcessSupervisorOptions = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
  stdin?: string;
  captureLimitBytesPerStream: number;
  terminationGraceMs: number;
  signal?: AbortSignal;
  onSpawn?: (identity: ProcessIdentity) => void;
  onOutput?: (event: ProcessOutputEvent) => void;
}>;

export type ProcessCompletedOutcome = Readonly<{
  status: "completed";
  identity: ProcessIdentity;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: ProcessCapture;
  stderr: ProcessCapture;
}>;

export type ProcessAbortedOutcome = Readonly<{
  status: "aborted";
  identity: ProcessIdentity | null;
  escalated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: ProcessCapture;
  stderr: ProcessCapture;
}>;

export type ProcessSpawnFailedOutcome = Readonly<{
  status: "spawn-failed";
  attemptedAt: string;
  commandHash: string;
  error: Readonly<{ message: string; code: string | null }>;
}>;

export type ProcessOutcome =
  | ProcessCompletedOutcome
  | ProcessAbortedOutcome
  | ProcessSpawnFailedOutcome;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCommand(command: string, args: readonly string[]): string {
  return hash(JSON.stringify([command, ...args]));
}

function parseProcessLine(line: string): ProcessIdentity | null {
  const match =
    /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/.exec(
      line,
    );
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null;
  }
  return {
    pid: Number(match[1]),
    processGroupId: Number(match[2]),
    osStartToken: match[3],
    observedCommandHash: hash(match[4] ?? ""),
  };
}

function inspectProcesses(args: readonly string[]): readonly ProcessIdentity[] {
  if (process.platform === "win32") {
    throw new Error("persisted process identity requires a POSIX process table");
  }
  const result = spawnSync("/bin/ps", args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr.trim() || `/bin/ps exited with status ${result.status}`);
  }
  return result.stdout
    .split("\n")
    .map(parseProcessLine)
    .filter((identity): identity is ProcessIdentity => identity !== null);
}

function inspectProcess(pid: number): ProcessIdentity | null {
  return (
    inspectProcesses(["-ww", "-o", "pid=,pgid=,lstart=,command=", "-p", String(pid)])[0] ??
    null
  );
}

function inspectProcessGroup(processGroupId: number): readonly ProcessIdentity[] {
  return inspectProcesses(["-axww", "-o", "pid=,pgid=,lstart=,command="]).filter(
    (identity) => identity.processGroupId === processGroupId,
  );
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return (
    left.pid === right.pid &&
    left.processGroupId === right.processGroupId &&
    left.osStartToken === right.osStartToken
  );
}

function validateGraceMs(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TIMER_MS) {
    throw new RangeError("terminationGraceMs must be an integer between 0 and 2147483647");
  }
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

function anyOwnedMemberRunning(ownedMembers: readonly ProcessIdentity[]): boolean {
  return ownedMembers.some((identity) => {
    const observed = inspectProcess(identity.pid);
    return observed !== null && sameIdentity(identity, observed);
  });
}

async function waitForOwnedMembers(
  ownedMembers: readonly ProcessIdentity[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (anyOwnedMemberRunning(ownedMembers)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(PROCESS_POLL_MS, timeoutMs)));
  }
  return true;
}

async function terminateRemainingProcessGroup(
  processGroupId: number,
  terminationGraceMs: number,
): Promise<ProcessTerminationOutcome> {
  const ownedMembers = inspectProcessGroup(processGroupId);
  if (ownedMembers.length === 0 || !anyOwnedMemberRunning(ownedMembers)) {
    return { status: "not-running", escalated: false };
  }

  signalProcessGroup(processGroupId, "SIGTERM");
  if (await waitForOwnedMembers(ownedMembers, terminationGraceMs)) {
    return { status: "terminated", escalated: false };
  }

  signalProcessGroup(processGroupId, "SIGKILL");
  const terminated = await waitForOwnedMembers(
    ownedMembers,
    Math.min(Math.max(terminationGraceMs, 20), 1_000),
  );
  return terminated
    ? { status: "terminated", escalated: true }
    : { status: "still-running", escalated: true };
}

function utf8Tail(buffer: Buffer, limit: number): string {
  let start = Math.max(0, buffer.length - limit);
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString("utf8");
}

class BoundedCapture {
  #text = "";
  #totalBytes = 0;

  constructor(readonly limit: number) {}

  append(data: string): void {
    const dataBytes = Buffer.from(data);
    this.#totalBytes += dataBytes.length;
    const combined = Buffer.concat([Buffer.from(this.#text), dataBytes]);
    this.#text =
      combined.length > this.limit ? utf8Tail(combined, this.limit) : combined.toString("utf8");
  }

  snapshot(): ProcessCapture {
    return {
      text: this.#text,
      totalBytes: this.#totalBytes,
      truncated: this.#totalBytes > Buffer.byteLength(this.#text),
    };
  }
}

function spawnFailed(
  attemptedAt: string,
  commandHash: string,
  error: Error,
): ProcessSpawnFailedOutcome {
  return {
    status: "spawn-failed",
    attemptedAt,
    commandHash,
    error: {
      message: error.message,
      code: (error as NodeJS.ErrnoException).code ?? null,
    },
  };
}

function emptyCapture(): ProcessCapture {
  return { text: "", totalBytes: 0, truncated: false };
}

export class ProcessSupervisor {
  readonly #options: ProcessSupervisorOptions;
  #identity: ProcessIdentity | undefined;
  #started = false;

  constructor(options: ProcessSupervisorOptions) {
    if (
      !Number.isSafeInteger(options.captureLimitBytesPerStream) ||
      options.captureLimitBytesPerStream <= 0
    ) {
      throw new RangeError("captureLimitBytesPerStream must be a positive safe integer");
    }
    validateGraceMs(options.terminationGraceMs);
    this.#options = options;
  }

  get identity(): ProcessIdentity | undefined {
    return this.#identity;
  }

  /**
   * Capture the durable identity of a process group that was just spawned by
   * KOTA. The leader requirement prevents callers from persisting an identity
   * for KOTA's own process group and later signalling unrelated siblings.
   */
  static identifySpawnedProcessGroup(pid: number): ProcessIdentity {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new RangeError("spawned process PID must be a positive safe integer");
    }
    const identity = inspectProcess(pid);
    if (identity === null) {
      throw new Error(`could not inspect spawned process ${pid}`);
    }
    if (identity.processGroupId !== pid) {
      throw new Error(`spawned process ${pid} did not become process-group leader`);
    }
    return identity;
  }

  static parsePersistedIdentity(value: unknown): ProcessIdentity {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Persisted process identity must be an object");
    }
    const identity = value as Partial<ProcessIdentity>;
    if (
      !Number.isSafeInteger(identity.pid) ||
      (identity.pid ?? 0) <= 0 ||
      !Number.isSafeInteger(identity.processGroupId) ||
      (identity.processGroupId ?? 0) <= 0 ||
      typeof identity.osStartToken !== "string" ||
      identity.osStartToken.length === 0 ||
      typeof identity.observedCommandHash !== "string" ||
      identity.observedCommandHash.length === 0
    ) {
      throw new Error("Persisted process identity is malformed");
    }
    return {
      pid: identity.pid!,
      processGroupId: identity.processGroupId!,
      osStartToken: identity.osStartToken,
      observedCommandHash: identity.observedCommandHash,
    };
  }

  static notifySpawnedProcessGroup(
    pid: number | undefined,
    observer: ProcessSpawnObserver | undefined,
  ): ProcessIdentity | undefined {
    if (observer === undefined) return undefined;
    if (pid === undefined) {
      throw new Error("spawned process did not expose a PID");
    }
    const identity = ProcessSupervisor.identifySpawnedProcessGroup(pid);
    observer(identity);
    return identity;
  }

  static verifyOwnedProcess(identity: ProcessIdentity): ProcessVerification {
    const observed = inspectProcess(identity.pid);
    if (observed === null) return { status: "not-running" };
    return sameIdentity(identity, observed)
      ? { status: "owned", observed }
      : { status: "identity-mismatch", observed };
  }

  static async terminateOwnedProcess(
    identity: ProcessIdentity,
    terminationGraceMs: number,
  ): Promise<ProcessTerminationOutcome> {
    validateGraceMs(terminationGraceMs);
    const verification = ProcessSupervisor.verifyOwnedProcess(identity);
    if (verification.status !== "owned") {
      return { ...verification, escalated: false };
    }

    const ownedMembers = inspectProcessGroup(identity.processGroupId);
    const leader = ownedMembers.find((member) => member.pid === identity.pid);
    if (leader === undefined || !sameIdentity(identity, leader)) {
      const observed = inspectProcess(identity.pid);
      return observed === null
        ? { status: "not-running", escalated: false }
        : { status: "identity-mismatch", escalated: false, observed };
    }

    signalProcessGroup(identity.processGroupId, "SIGTERM");
    if (await waitForOwnedMembers(ownedMembers, terminationGraceMs)) {
      return { status: "terminated", escalated: false };
    }

    // A still-matching member proves the original process group has not been reused.
    signalProcessGroup(identity.processGroupId, "SIGKILL");
    const terminated = await waitForOwnedMembers(
      ownedMembers,
      Math.min(Math.max(terminationGraceMs, 20), 1_000),
    );
    return terminated
      ? { status: "terminated", escalated: true }
      : { status: "still-running", escalated: true };
  }

  async run(): Promise<ProcessOutcome> {
    if (this.#started) throw new Error("ProcessSupervisor instances can only run once");
    this.#started = true;

    const attemptedAt = new Date().toISOString();
    const attemptedCommandHash = hashCommand(this.#options.command, this.#options.args);
    if (this.#options.signal?.aborted) {
      return {
        status: "aborted",
        identity: null,
        escalated: false,
        exitCode: null,
        signal: null,
        stdout: emptyCapture(),
        stderr: emptyCapture(),
      };
    }

    let child: ChildProcess;
    try {
      child = spawn(this.#options.command, this.#options.args, {
        cwd: this.#options.cwd,
        env: { ...this.#options.env },
        detached: process.platform !== "win32",
        stdio: [this.#options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return spawnFailed(
        attemptedAt,
        attemptedCommandHash,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    const pid = child.pid;
    if (pid === undefined) {
      return new Promise((resolve) => {
        child.once("error", (error) => {
          resolve(spawnFailed(attemptedAt, attemptedCommandHash, error));
        });
      });
    }

    try {
      const identity = ProcessSupervisor.identifySpawnedProcessGroup(pid);
      this.#identity = identity;
      this.#options.onSpawn?.(identity);
      if (this.#options.stdin !== undefined) {
        child.stdin?.end(this.#options.stdin);
      }
    } catch (error) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-pid, "SIGKILL");
      } catch {
        // The child may have already exited while its identity was being inspected.
      }
      return spawnFailed(
        attemptedAt,
        attemptedCommandHash,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return this.#waitForCompletion(child, this.#identity);
  }

  #waitForCompletion(child: ChildProcess, identity: ProcessIdentity): Promise<ProcessOutcome> {
    const stdout = new BoundedCapture(this.#options.captureLimitBytesPerStream);
    const stderr = new BoundedCapture(this.#options.captureLimitBytesPerStream);
    let aborted = false;
    let termination: Promise<ProcessTerminationOutcome> | undefined;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (data: string) => {
      stdout.append(data);
      this.#options.onOutput?.({ stream: "stdout", data });
    });
    child.stderr?.on("data", (data: string) => {
      stderr.append(data);
      this.#options.onOutput?.({ stream: "stderr", data });
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const removeAbortListener = () => {
        this.#options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        void (async () => {
          try {
            const terminationOutcome = await termination;
            const output = {
              identity,
              exitCode,
              signal,
              stdout: stdout.snapshot(),
              stderr: stderr.snapshot(),
            };
            resolve(
              aborted
                ? {
                    status: "aborted",
                    escalated: terminationOutcome?.escalated ?? false,
                    ...output,
                  }
                : { status: "completed", ...output },
            );
          } catch (error) {
            reject(error);
          }
        })();
      };
      const onAbort = () => {
        if (aborted) return;
        aborted = true;
        termination = ProcessSupervisor.terminateOwnedProcess(
          identity,
          this.#options.terminationGraceMs,
        );
      };
      this.#options.signal?.addEventListener("abort", onAbort, { once: true });
      if (this.#options.signal?.aborted) onAbort();
      child.once("exit", () => {
        if (termination === undefined) {
          termination = terminateRemainingProcessGroup(
            identity.processGroupId,
            this.#options.terminationGraceMs,
          );
        }
      });
      child.once("error", (error) => {
        settled = true;
        removeAbortListener();
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        finish(exitCode, signal);
      });
    });
  }
}
