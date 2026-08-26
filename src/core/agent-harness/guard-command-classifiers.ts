import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type WorkflowShellTeardownKind = "local-work" | "infrastructure";

const PACKAGE_PROJECT_MARKERS = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

const PACKAGE_BOOTSTRAP_ALLOW_MARKER = ".kota/allow-package-bootstrap";

export function normalizeCommand(command: string): string {
  return command.replace(/\\\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

export function hasPackageProjectMarker(startDir: string): boolean {
  let current = resolve(startDir);
  while (true) {
    if (PACKAGE_PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function hasPackageBootstrapAllowMarker(startDir: string): boolean {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, PACKAGE_BOOTSTRAP_ALLOW_MARKER))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

// Matches a `git ... commit` subcommand as a standalone token anywhere in a
// shell command. Flag tokens (`-C path`, `--no-verify`, single-char flags) and
// short arguments like `-C /tmp` are skipped. `commit` must appear as its own
// word followed by end-of-command, whitespace, or a shell separator so tokens
// like `my-commit` or `git-commit-tree` do not trigger.
const GIT_COMMIT_PATTERN =
  /(?:^|[\s;&|()`])git\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*commit(?=$|\s|[;&|()`])/;

const GIT_METADATA_MUTATION_PATTERN =
  /(?:^|[\s;&|()`])(?:\S*\/)?git\s+(?:(?:(?:-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)\s+(?:"[^"]*"|'[^']*'|[^\s;&|()`]+)|(?:--git-dir|--work-tree|--namespace|--super-prefix|--config-env)=\S+|--bare|--no-pager|--paginate|-p|-P)\s+)*(?:add|am|apply|bisect|branch|checkout|cherry-pick|clean|commit|config|gc|merge|mv|notes|push|rebase|reset|restore|revert|rm|stash|switch|tag|update-ref|worktree)(?=$|\s|[;&|()`])/;

const GIT_RESET_HARD_PATTERN =
  /(?:^|[\s;&|()`])git\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*reset(?=$|\s|[;&|()`])(?=[^;&|()`]*\s--hard(?=$|\s|[;&|()`]))/;

const GIT_CHECKOUT_COMMAND_PATTERN =
  /(?:^|[\s;&|()`])git\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*checkout(?=$|\s|[;&|()`])([^;&|()`]*)/g;

const GIT_RESTORE_COMMAND_PATTERN =
  /(?:^|[\s;&|()`])git\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*restore(?=$|\s|[;&|()`])([^;&|()`]*)/g;

const GIT_CLEAN_COMMAND_PATTERN =
  /(?:^|[\s;&|()`])git\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*clean(?=$|\s|[;&|()`])([^;&|()`]*)/g;

const INFRASTRUCTURE_DESTROY_PATTERN =
  /(?:^|[\s;&|()`])(?:terraform|pulumi|cdk)\s+destroy(?=$|\s|[;&|()`])/;

const TERRAFORM_APPLY_COMMAND_PATTERN =
  /(?:^|[\s;&|()`])terraform\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*apply(?=$|\s|[;&|()`])([^;&|()`]*)/g;

function gitCleanFlagHasShortOption(arg: string, option: "d" | "f"): boolean {
  return /^-[A-Za-z]+$/.test(arg) && arg.includes(option);
}

function splitCommandArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function isCommandOption(arg: string): boolean {
  return arg.startsWith("-") && arg !== "-";
}

function hasPathspecArg(args: string[]): boolean {
  const pathspecSeparatorIndex = args.indexOf("--");
  if (pathspecSeparatorIndex >= 0) {
    return args.slice(pathspecSeparatorIndex + 1).some(Boolean);
  }
  return args.some((arg) => !isCommandOption(arg));
}

function isGitCheckoutPathDiscardCommand(command: string): boolean {
  for (const match of command.matchAll(GIT_CHECKOUT_COMMAND_PATTERN)) {
    const args = splitCommandArgs(match[1] ?? "");
    const pathspecSeparatorIndex = args.indexOf("--");
    if (pathspecSeparatorIndex >= 0 && args.slice(pathspecSeparatorIndex + 1).some(Boolean)) {
      return true;
    }
  }
  return false;
}

function isGitRestorePathDiscardCommand(command: string): boolean {
  for (const match of command.matchAll(GIT_RESTORE_COMMAND_PATTERN)) {
    if (hasPathspecArg(splitCommandArgs(match[1] ?? ""))) return true;
  }
  return false;
}

function isGitCleanForceDirectoryCommand(command: string): boolean {
  for (const match of command.matchAll(GIT_CLEAN_COMMAND_PATTERN)) {
    const args = splitCommandArgs(match[1] ?? "");
    const hasForce = args.some(
      (arg) => arg === "--force" || gitCleanFlagHasShortOption(arg, "f"),
    );
    const hasDirectory = args.some(
      (arg) => arg === "--directory" || gitCleanFlagHasShortOption(arg, "d"),
    );
    if (hasForce && hasDirectory) return true;
  }
  return false;
}

function isTruthyDestroyFlag(arg: string): boolean {
  if (arg === "-destroy" || arg === "--destroy") return true;
  const value = arg.match(/^--?destroy=(.+)$/)?.[1];
  if (value === undefined) return false;
  return !["false", "0", "no"].includes(value.toLowerCase());
}

function isTerraformApplyDestroyCommand(command: string): boolean {
  for (const match of command.matchAll(TERRAFORM_APPLY_COMMAND_PATTERN)) {
    const args = splitCommandArgs(match[1] ?? "");
    if (args.some(isTruthyDestroyFlag)) return true;
  }
  return false;
}

export function isGitCommitCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized) return false;
  return GIT_COMMIT_PATTERN.test(normalized);
}

export function isGitMetadataMutationCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized) return false;
  return GIT_METADATA_MUTATION_PATTERN.test(normalized);
}

export function classifyWorkflowShellTeardownCommand(
  command: string,
): WorkflowShellTeardownKind | null {
  const normalized = normalizeCommand(command);
  if (!normalized) return null;
  if (
    GIT_RESET_HARD_PATTERN.test(normalized) ||
    isGitCheckoutPathDiscardCommand(normalized) ||
    isGitRestorePathDiscardCommand(normalized) ||
    isGitCleanForceDirectoryCommand(normalized)
  ) {
    return "local-work";
  }
  if (
    INFRASTRUCTURE_DESTROY_PATTERN.test(normalized) ||
    isTerraformApplyDestroyCommand(normalized)
  ) return "infrastructure";
  return null;
}

export function isPackageBootstrapCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized) return false;
  return /(?:^|[\s;&|()])(?:npm\s+(?:install|i)\b|pnpm\s+(?:install|i)\b|yarn\s+(?:install|add)\b|bun\s+install\b|corepack\s+(?:enable|prepare|use)\b)(?=$|[\s;&|()])/.test(
    normalized,
  );
}
