import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type VerifyCommand = {
  label: string;
  command: string;
};

/** Detect available verification commands from project config files. */
export function detectVerifyCommands(cwd?: string): VerifyCommand[] {
  const dir = cwd || process.cwd();
  const commands: VerifyCommand[] = [];

  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts || {};

      // Detect package manager from lock file
      const pm = existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))
        ? "bun"
        : existsSync(join(dir, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(dir, "yarn.lock"))
            ? "yarn"
            : "npm";

      const targets: Array<[string, string]> = [
        ["test", "test"],
        ["typecheck", "run typecheck"],
        ["type-check", "run type-check"],
        ["lint", "run lint"],
        ["check", "run check"],
        ["build", "run build"],
      ];

      for (const [script, suffix] of targets) {
        if (scripts[script]) {
          commands.push({ label: script, command: `${pm} ${suffix}` });
        }
      }
    } catch {
      /* ignore malformed package.json */
    }
  }

  if (existsSync(join(dir, "Makefile"))) {
    try {
      const content = readFileSync(join(dir, "Makefile"), "utf-8");
      for (const target of ["test", "lint", "check", "build"]) {
        if (new RegExp(`^${target}\\s*:`, "m").test(content)) {
          commands.push({ label: target, command: `make ${target}` });
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (existsSync(join(dir, "Cargo.toml"))) {
    commands.push(
      { label: "check", command: "cargo check" },
      { label: "test", command: "cargo test" },
    );
  }

  if (existsSync(join(dir, "pyproject.toml"))) {
    commands.push({ label: "test", command: "pytest" });
  }

  if (existsSync(join(dir, "deno.json")) || existsSync(join(dir, "deno.jsonc"))) {
    commands.push(
      { label: "test", command: "deno test" },
      { label: "lint", command: "deno lint" },
      { label: "check", command: "deno check" },
    );
  }

  return commands;
}

const VERIFY_PATTERNS = [
  /\bnpm (run )?(test|lint|build|typecheck|type-check|check)\b/,
  /\bpnpm (run )?(test|lint|build|typecheck|type-check|check)\b/,
  /\byarn (run )?(test|lint|build|typecheck|type-check|check)\b/,
  /\bbun (run )?(test|lint|build|typecheck|type-check|check)\b/,
  /\bdeno (test|lint|check|bench)\b/,
  /\bcargo (test|check|clippy|build)\b/,
  /\bpytest\b/,
  /\bpython -m pytest\b/,
  /\bgo (test|vet|build)\b/,
  /\bmake (test|lint|check|build)\b/,
  /\btsc\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bbiome (check|lint)\b/,
  /\beslint\b/,
];

/** Check if a shell command is a verification command. */
export function isVerifyCommand(command: string): boolean {
  return VERIFY_PATTERNS.some((p) => p.test(command));
}

/**
 * Tracks file modifications and verification status during a session.
 * Injects nudges into the dynamic system prompt when edits accumulate
 * without verification — preventing the #1 agent failure mode.
 */
export class VerifyTracker {
  private editedFiles = new Set<string>();
  private turnsSinceLastVerify = 0;
  private commands: VerifyCommand[];

  constructor(commands: VerifyCommand[] = []) {
    this.commands = commands;
  }

  /** Record that a file was modified by an edit/write tool. */
  recordEdit(path: string): void {
    if (path) this.editedFiles.add(path);
  }

  /** Check if a shell command is verification. If so, clear unverified edits. */
  checkShellCommand(command: string): void {
    if (isVerifyCommand(command)) {
      this.editedFiles.clear();
      this.turnsSinceLastVerify = 0;
    }
  }

  /** Advance the turn counter. Call once per agent loop iteration. */
  tick(): void {
    if (this.editedFiles.size > 0) {
      this.turnsSinceLastVerify++;
    }
  }

  /** Dynamic state string for injection into system prompt. Empty if nothing to report. */
  getState(): string {
    if (this.editedFiles.size === 0) return "";

    const allFiles = [...this.editedFiles];
    const files = allFiles.slice(-10);
    const parts: string[] = [];
    const extra = allFiles.length > 10 ? ` (${allFiles.length} total)` : "";
    parts.push(`[Unverified edits${extra}: ${files.join(", ")}]`);

    if (this.commands.length > 0) {
      const cmds = this.commands
        .slice(0, 3)
        .map((c) => `\`${c.command}\``)
        .join(", ");
      parts.push(`[Verify with: ${cmds}]`);
    }

    if (this.turnsSinceLastVerify >= 3) {
      parts.push("[Consider verifying before making more changes]");
    }

    return `\n\n${parts.join("\n")}`;
  }

  /** Number of files edited but not yet verified. */
  getUnverifiedCount(): number {
    return this.editedFiles.size;
  }
}

/** Minimal tool call shape — avoids SDK dependency. */
export type ToolCallRecord = {
  name: string;
  id: string;
  input: unknown;
};

/** Minimal tool result shape. */
export type ToolResultRecord = {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/**
 * Extract edit/verification events from completed tool calls.
 * Parses tool inputs and results to update the VerifyTracker.
 */
export function processToolResults(
  tracker: VerifyTracker,
  toolCalls: ToolCallRecord[],
  results: ToolResultRecord[],
): void {
  for (const call of toolCalls) {
    const result = results.find((r) => r.tool_use_id === call.id);
    const input = call.input as Record<string, unknown>;

    if (result && !result.is_error) {
      if (call.name === "file_edit" || call.name === "file_write") {
        tracker.recordEdit((input.path as string) || "");
      } else if (call.name === "multi_edit") {
        const edits = input.edits as Array<{ file_path?: string }> | undefined;
        if (edits) {
          for (const e of edits) {
            if (e.file_path) tracker.recordEdit(e.file_path);
          }
        }
      } else if (call.name === "find_replace") {
        for (const line of result.content.split("\n")) {
          const m = line.match(/^\s{2}(\S.+?):\s+\d+\s+replacement/);
          if (m) tracker.recordEdit(m[1]);
        }
      } else if (call.name === "delegate") {
        const idx = result.content.indexOf("--- Modified files");
        if (idx !== -1) {
          for (const line of result.content.slice(idx).split("\n")) {
            const m = line.match(/^\s{2}-\s+(.+)/);
            if (m) tracker.recordEdit(m[1]);
          }
        }
      }
    }

    if (call.name === "shell" && result && !result.is_error) {
      tracker.checkShellCommand((input.command as string) || "");
    }

    // Detect verification through background process tool
    if (call.name === "process" && result && !result.is_error) {
      const action = input.action as string;
      let cmd: string | undefined;

      if (action === "start") {
        cmd = input.command as string;
      } else if (action === "output") {
        const cmdMatch = result.content.match(/^Command:\s*(.+)/m);
        if (cmdMatch) cmd = cmdMatch[1];
      }

      if (cmd && isVerifyCommand(cmd) && /exited \(code 0\)/.test(result.content)) {
        tracker.checkShellCommand(cmd);
      }
    }
  }
  tracker.tick();
}
