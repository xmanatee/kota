import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const root = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

try {
  const repositoryRoot = git("rev-parse", "--show-toplevel");
  const hookDirectory = join(root, ".githooks");
  const hook = join(hookDirectory, "pre-commit");
  if (!existsSync(hook)) throw new Error(`Tracked pre-commit hook is missing: ${hook}`);
  const configured = spawnSync("git", ["config", "--path", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  if (configured.error || (configured.status !== 0 && configured.status !== 1)) {
    throw new Error(`Cannot inspect existing Git hooks configuration: ${configured.error?.message ?? configured.stderr}`);
  }
  const value = configured.status === 0 ? configured.stdout.trim() : git("rev-parse", "--git-path", "hooks");
  const hooks = isAbsolute(value) ? value : resolve(repositoryRoot, value);
  if (hooks !== hookDirectory) {
    if (configured.status === 0) {
      throw new Error(`Configured Git hooks path is preserved (${value}). Add "pnpm --dir ${JSON.stringify(root)} validate-tasks --staged" to its pre-commit hook.`);
    }
    const existing = existsSync(hooks) ? readdirSync(hooks).filter((name) => !name.endsWith(".sample")) : [];
    if (existing.length) {
      throw new Error(`Existing Git hooks are preserved (${existing.join(", ")}). Add "pnpm --dir ${JSON.stringify(root)} validate-tasks --staged" to your existing pre-commit hook.`);
    }
    git("config", "--local", "core.hooksPath", relative(repositoryRoot, hookDirectory));
  }
  chmodSync(hook, 0o755);
  process.stdout.write("Installed tracked staged-task validation hook.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
