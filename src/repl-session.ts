import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SENTINEL, DONE_MARKER, PYTHON_WRAPPER, NODE_WRAPPER } from "./code-wrappers.js";

export type Language = "python" | "node";

/** Find the best Python binary, preferring a local virtualenv over system python3. */
export function findPythonBinary(cwd: string): string {
  for (const dir of [".venv", "venv"]) {
    const bin = join(cwd, dir, "bin", "python");
    if (existsSync(bin)) return bin;
  }
  return "python3";
}

export class REPLSession {
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
        ? [findPythonBinary(process.cwd()), ["-u", "-c", PYTHON_WRAPPER]]
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
    const crashRestarted = !this.alive && this.proc !== null;
    if (!this.alive || !this.proc) this.start();
    const proc = this.proc!;
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      return { output: "Process stdio not available", isError: true };
    }

    const result = await new Promise<{ output: string; isError: boolean }>((resolve) => {
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
        const msg = parts.join("\n") || `Process exited with code ${code}`;
        settle({
          output: `${msg}\n[Session crashed — all variables, imports, and state were lost. Re-import modules and re-load data.]`,
          isError: true,
        });
      };

      const timeoutMsg = `Execution timed out after ${timeoutMs}ms. Session was reset — all state (variables, imports) lost.\nTo recover: re-import modules and re-load data. Consider increasing timeout_ms or processing in smaller chunks.`;
      const timer = setTimeout(() => {
        if (this.language === "python" && this.proc) {
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

      proc.stdin!.write(code + "\n" + SENTINEL + "\n");
    });
    if (crashRestarted) {
      return {
        output: `[Session restarted — previous session crashed. All variables, imports, and state were lost. Re-import modules and re-load data.]\n${result.output}`,
        isError: result.isError,
      };
    }
    return result;
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
export const sessions: Record<Language, REPLSession> = {
  python: new REPLSession("python"),
  node: new REPLSession("node"),
};

/** Kill all REPL sessions. Called on agent shutdown. */
export function cleanupSessions(): void {
  sessions.python.kill();
  sessions.node.kill();
}
