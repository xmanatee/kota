/** Patterns in shell/process commands that indicate destructive operations. */
export const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+checkout\s+\./,
  /\bdocker\s+rm\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s/,
  /\bkill\b/,
  /\bchmod\b.*777/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  />\s*\/dev\/sd/,
  /\bcurl\b.*-X\s*(DELETE|PUT|POST|PATCH)\b/,
  /\bwget\b.*--post/,
];

/** Patterns in code_exec that indicate system-level operations. */
export const DANGEROUS_CODE_PATTERNS = [
  /\bos\.system\b/,
  /\bsubprocess\b/,
  /\bchild_process\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bshutil\.rmtree\b/,
  /\bfs\.rmSync\b/,
  /\bfs\.unlinkSync\b/,
];

/** HTTP methods that mutate remote state. */
export const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function isDangerousCode(code: string): boolean {
  return DANGEROUS_CODE_PATTERNS.some((pattern) => pattern.test(code));
}
