import type Anthropic from "@anthropic-ai/sdk";
import { spawn, execFile as execFileCb, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { which } from "../runtime-check.js";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { extractPlots, readPlotFiles } from "../plot-capture.js";
import { SENTINEL, DONE_MARKER, DEFAULT_TIMEOUT, MAX_OUTPUT, PYTHON_WRAPPER, NODE_WRAPPER } from "../code-wrappers.js";

const execFileP = promisify(execFileCb);

type Language = "python" | "node";

class REPLSession {
  private proc: ChildProcess | null = null;
  private language: Language;
  private alive = false;

  constructor(language: Language) {
    this.language = language;
  }

  private start(): void {
    if (this.alive) return;

    const [cmd, args] =
      this.language === "python"
        ? ["python3", ["-u", "-c", PYTHON_WRAPPER]]
        : ["node", ["-e", NODE_WRAPPER]];

    this.proc = spawn(cmd, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.alive = true;
    // Guard: only update state if this is still the current process.
    // Prevents old process's exit event from resetting a new session.
    const ref = this.proc;
    ref.on("exit", () => { if (this.proc === ref) this.alive = false; });
    ref.on("error", () => { if (this.proc === ref) this.alive = false; });
  }

  async execute(
    code: string,
    timeoutMs: number,
  ): Promise<{ output: string; isError: boolean }> {
    if (!this.alive || !this.proc) this.start();
    const proc = this.proc!;
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      return { output: "Process stdio not available", isError: true };
    }

    return new Promise((resolve) => {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let stdoutBuf = "";
      let settled = false;
      let interrupted = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (result: { output: string; isError: boolean }) => {
        if (settled) return;
        settled = true;
        proc.stdout!.removeListener("data", onStdout);
        proc.stderr!.removeListener("data", onStderr);
        proc.removeListener("exit", onExit);
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (interrupted && !result.isError) {
          resolve({
            output: result.output + `\n\n[Interrupted after ${timeoutMs}ms — session state preserved. Variables and imports are still available.]`,
            isError: false,
          });
          return;
        }
        resolve(result);
      };

      const onStdout = (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const idx = stdoutBuf.indexOf(DONE_MARKER + "\n");
        if (idx !== -1) {
          const before = stdoutBuf.slice(0, idx).trim();
          if (before) stdoutChunks.push(before);
          const stderr = stderrChunks.join("").trim();
          const stdout = stdoutChunks.join("").trim();
          const parts = [stdout, stderr].filter(Boolean);
          const output = parts.join("\n") || "(no output)";
          // Done marker reached = execution completed. Not a tool error.
          // Code-level errors (tracebacks) are visible in the output text.
          settle({ output, isError: false });
        }
      };

      const onStderr = (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
      };

      const onExit = (code: number | null) => {
        const stderr = stderrChunks.join("").trim();
        const stdout = stdoutBuf.trim();
        const parts = [stdout, stderr].filter(Boolean);
        settle({
          output: parts.join("\n") || `Process exited with code ${code}`,
          isError: true,
        });
      };

      const timeoutMsg = `Execution timed out after ${timeoutMs}ms. Session was reset — all state (variables, imports) lost.\nTo recover: re-import modules and re-load data. Consider increasing timeout_ms or processing in smaller chunks.`;
      const timer = setTimeout(() => {
        if (this.language === "python" && this.proc) {
          // Python: try SIGINT first — raises KeyboardInterrupt, preserves session state
          interrupted = true;
          try { proc.kill("SIGINT"); } catch {}
          killTimer = setTimeout(() => {
            if (!settled) {
              this.kill();
              settle({ output: timeoutMsg, isError: true });
            }
          }, 3_000);
        } else {
          this.kill();
          settle({ output: timeoutMsg, isError: true });
        }
      }, timeoutMs);

      proc.stdout!.on("data", onStdout);
      proc.stderr!.on("data", onStderr);
      proc.on("exit", onExit);

      // Send code + sentinel to trigger execution
      proc.stdin!.write(code + "\n" + SENTINEL + "\n");
    });
  }

  kill(): void {
    if (this.proc) {
      try { this.proc.kill("SIGTERM"); } catch {}
      const ref = this.proc;
      setTimeout(() => { try { ref.kill("SIGKILL"); } catch {} }, 2000);
    }
    this.alive = false;
    this.proc = null;
  }

  isAlive(): boolean {
    return this.alive;
  }
}

// One session per language, reused across calls
const sessions: Record<Language, REPLSession> = {
  python: new REPLSession("python"),
  node: new REPLSession("node"),
};

/** Kill all REPL sessions. Called on agent shutdown. */
export function cleanupSessions(): void {
  sessions.python.kill();
  sessions.node.kill();
}

export const codeExecTool: Anthropic.Tool = {
  name: "code_exec",
  description:
    "Execute code in a persistent REPL session. Variables, imports, and state persist " +
    "across calls — ideal for iterative data analysis, computation, math, prototyping, " +
    "and exploration. Supports Python and Node.js (each has its own session).",
  input_schema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "The code to execute",
      },
      language: {
        type: "string",
        enum: ["python", "node"],
        description: "Language runtime (default: python)",
      },
      timeout_ms: {
        type: "number",
        description: "Execution timeout in ms (default: 30000)",
      },
      reset: {
        type: "boolean",
        description: "Reset the session (kill and restart) before executing",
      },
    },
    required: ["code"],
  },
};

export async function runCodeExec(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const code = input.code as string;
  const language = (input.language as Language) || "python";
  const timeoutMs = (input.timeout_ms as number) || DEFAULT_TIMEOUT;
  const reset = (input.reset as boolean) || false;

  if (!code) {
    return { content: "Error: code is required", is_error: true };
  }
  if (language !== "python" && language !== "node") {
    return {
      content: `Error: language must be "python" or "node", got "${language}"`,
      is_error: true,
    };
  }

  // Check runtime availability
  const cmd = language === "python" ? "python3" : "node";
  if (!which(cmd)) {
    return {
      content: `Error: ${cmd} not found. Install ${language === "python" ? "Python 3" : "Node.js"} to use code_exec with language="${language}".`,
      is_error: true,
    };
  }

  const session = sessions[language];
  if (reset) session.kill();

  let { output, isError } = await session.execute(code, timeoutMs);

  // Auto-install missing Python packages and retry (one attempt)
  const missingPkg = extractMissingPackage(output, language);
  if (missingPkg) {
    const retry = await tryAutoInstall(missingPkg, code, session, timeoutMs);
    if (retry) {
      output = retry.output;
      isError = retry.isError;
    }
  }

  // Separate plot markers from text output (Python matplotlib auto-capture)
  const { text: cleanOutput, plotPaths } = extractPlots(output);

  const truncated =
    cleanOutput.length > MAX_OUTPUT
      ? cleanOutput.slice(0, MAX_OUTPUT) +
        `\n[truncated — ${cleanOutput.length} chars total]`
      : cleanOutput;

  const hint = detectPackageHint(truncated, language);
  const content = hint ? `${truncated}\n\n${hint}` : truncated;

  const imageBlocks = readPlotFiles(plotPaths);
  if (imageBlocks.length > 0) {
    const blocks: ToolResultBlock[] = [
      { type: "text", text: content },
      ...imageBlocks,
    ];
    return { content, blocks, is_error: isError };
  }

  return { content, is_error: isError };
}

/** Detect missing package errors and suggest install commands. */
export function detectPackageHint(output: string, language: Language): string | null {
  if (language === "python") {
    const match = output.match(/ModuleNotFoundError: No module named '([^']+)'/);
    if (match) {
      const pkg = match[1].split(".")[0];
      return `Tip: Install the missing package with shell: pip install ${pkg}`;
    }
  } else {
    const match = output.match(/Cannot find module '([^']+)'/);
    if (match) {
      const pkg = match[1];
      if (!pkg.startsWith(".") && !pkg.startsWith("/")) {
        return `Tip: Install the missing package with shell: npm install ${pkg}`;
      }
    }
  }
  return null;
}

/** Extract the missing package name from a Python ModuleNotFoundError. */
export function extractMissingPackage(output: string, language: string): string | null {
  if (language !== "python") return null;
  const m = output.match(/ModuleNotFoundError: No module named '([^']+)'/);
  if (!m) return null;
  const pkg = m[1].split(".")[0];
  return /^[a-zA-Z0-9_-]+$/.test(pkg) ? pkg : null;
}

/** Try to pip-install a missing package and re-run the code. Returns null on failure. */
async function tryAutoInstall(
  pkg: string,
  code: string,
  session: REPLSession,
  timeoutMs: number,
): Promise<{ output: string; isError: boolean } | null> {
  try {
    await execFileP("python3", ["-m", "pip", "install", "--quiet", pkg], {
      timeout: 60_000,
    });
  } catch {
    return null;
  }
  const retryCode = "import importlib; importlib.invalidate_caches()\n" + code;
  const result = await session.execute(retryCode, timeoutMs);
  return {
    output: `[Auto-installed ${pkg} via pip]\n${result.output}`,
    isError: result.isError,
  };
}
