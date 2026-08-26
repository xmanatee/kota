import { execFile } from "node:child_process";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
	parseAddArguments,
	parseBranchArguments,
	parseCommitArguments,
	parseDiffArguments,
	parseLogArguments,
	parseShowArguments,
	parseStatusArguments,
} from "./git-arguments.js";
import { parsePushArguments } from "./push-arguments.js";
import { protectedNonLeaseForcePushTarget } from "./push-safety.js";

export const gitTool: KotaTool = {
	name: "git",
	description:
		"Git version control operations with safety guardrails and token-efficient output. " +
		"Operations: status, diff, log, show, add, commit, branch, push. " +
		"Large diffs are auto-truncated. Force-push to main/master is blocked.",
	input_schema: {
		type: "object" as const,
		properties: {
			op: {
				type: "string",
				enum: ["status", "diff", "log", "show", "add", "commit", "branch", "push"],
				description: "The git operation to perform",
			},
			args: {
				type: "string",
				description:
					"Operation-specific arguments are strictly parsed; unsupported flags and repository-external local paths are rejected. " +
					"status: (none). " +
					"diff: optional path or ref (e.g. 'HEAD~3', 'src/', 'main..feature'). " +
					"log: optional format flags (default: --oneline -20). " +
					"show: commit ref (default: HEAD). " +
					"add: file paths, space-separated (required). " +
					"commit: commit message (required). " +
					"branch: subcommand — empty=list, 'name'=create, '-d name'=delete, 'checkout name'=switch. " +
					"push: optional remote/branch (default: current tracking branch).",
			},
		},
		required: ["op"],
	},
};

const MAX_DIFF_CHARS = 15_000;
const PROTECTED_BRANCHES = new Set(["main", "master"]);

function truncateDiff(text: string): string {
	if (text.length <= MAX_DIFF_CHARS) return text;
	const headSize = Math.floor(MAX_DIFF_CHARS * 0.6);
	const tailSize = Math.floor(MAX_DIFF_CHARS * 0.3);
	return (
		text.slice(0, headSize) +
		`\n\n... [truncated — diff was ${text.length} chars, showing first ${headSize} + last ${tailSize}] ...\n\n` +
		text.slice(-tailSize)
	);
}

function git(args: string[], context?: ToolRunnerContext): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const proc = execFile("git", args, {
			cwd: context?.cwd ?? process.cwd(),
			env: withProtectedGitBareRepositoryEnv(),
			maxBuffer: 5 * 1024 * 1024,
			timeout: 30_000,
		}, (error, stdout, stderr) => {
			resolve({
				stdout: stdout ?? "",
				stderr: stderr ?? "",
				code: error?.code === "ERR_CHILD_PROCESS_STDIO_FINAL" ? 0 : (proc.exitCode ?? (error ? 1 : 0)),
			});
		});
	});
}

function getCurrentBranch(context?: ToolRunnerContext): Promise<string> {
	return git(["rev-parse", "--abbrev-ref", "HEAD"], context).then((r) => r.stdout.trim());
}

async function readGitConfigValues(
	key: string,
	context?: ToolRunnerContext,
): Promise<readonly string[]> {
	const result = await git(["config", "--null", "--get-all", key], context);
	if (result.code === 1) return [];
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || `git config failed for ${key}`);
	}
	const values = result.stdout.split("\0");
	if (values.at(-1) === "") values.pop();
	return values;
}

async function readGitConfigBoolean(
	key: string,
	context?: ToolRunnerContext,
): Promise<boolean | null> {
	const result = await git(["config", "--bool", "--get", key], context);
	if (result.code === 1) return null;
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || `git config failed for ${key}`);
	}
	return result.stdout.trim() === "true";
}

async function hasGitRemote(
	name: string,
	context?: ToolRunnerContext,
): Promise<boolean> {
	const result = await git(["remote"], context);
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || "git remote failed");
	}
	return result.stdout.split(/\r?\n/).includes(name);
}

async function readGitRemoteGroup(
	name: string,
	context?: ToolRunnerContext,
): Promise<readonly string[]> {
	const result = await git(
		["config", "--null", "--get-regexp", "^remotes\\."],
		context,
	);
	if (result.code === 1) return [];
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || "git config failed for remote groups");
	}
	const values: string[] = [];
	for (const entry of result.stdout.split("\0")) {
		if (!entry) continue;
		const separator = entry.indexOf("\n");
		if (separator < 0 || entry.slice(0, separator) !== `remotes.${name}`) continue;
		values.push(...entry.slice(separator + 1).split(/\s+/).filter(Boolean));
	}
	return values;
}

function argumentError(message: string): ToolResult {
	return { content: `Error: ${message}`, is_error: true };
}

function repoRoot(context?: ToolRunnerContext): string {
	return context?.cwd ?? process.cwd();
}

async function opStatus(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseStatusArguments(args);
	if (!parsed.ok) return argumentError(parsed.message);
	const result = await git(["status", "--short", "--branch"], context);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim() || result.stdout.trim()}`, is_error: true };
	}
	return { content: result.stdout.trim() || "(clean working tree)" };
}

async function opDiff(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseDiffArguments(args, repoRoot(context));
	if (!parsed.ok) return argumentError(parsed.message);
	const safeOptions = ["--no-ext-diff", "--no-textconv"];
	const result = await git(["diff", ...safeOptions, "--stat", ...parsed.value], context);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim()}`, is_error: true };
	}
	const full = await git(["diff", ...safeOptions, ...parsed.value], context);
	const diff = full.stdout.trim();
	if (!diff) return { content: "(no changes)" };
	return { content: truncateDiff(diff) };
}

async function opLog(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseLogArguments(args, repoRoot(context));
	if (!parsed.ok) return argumentError(parsed.message);
	const result = await git(
		["log", "--no-ext-diff", "--no-textconv", ...parsed.value],
		context,
	);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim()}`, is_error: true };
	}
	return { content: result.stdout.trim() || "(no commits)" };
}

async function opShow(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseShowArguments(args, repoRoot(context));
	if (!parsed.ok) return argumentError(parsed.message);
	const safeOptions = ["--no-ext-diff", "--no-textconv"];
	const result = await git(["show", ...safeOptions, "--stat", parsed.value, "--"], context);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim()}`, is_error: true };
	}
	const full = await git(["show", ...safeOptions, parsed.value, "--"], context);
	return { content: truncateDiff(full.stdout.trim()) };
}

async function opAdd(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseAddArguments(args, repoRoot(context));
	if (!parsed.ok) return argumentError(parsed.message);
	const result = await git(["add", "--", ...parsed.value], context);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim()}`, is_error: true };
	}
	const status = await git(["status", "--short"], context);
	return { content: `Staged. Current status:\n${status.stdout.trim()}` };
}

async function opCommit(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseCommitArguments(args);
	if (!parsed.ok) return argumentError(parsed.message);
	const result = await git(["commit", "-m", parsed.value], context);
	if (result.code !== 0) {
		const msg = result.stderr.trim() || result.stdout.trim();
		return { content: `Error: ${msg}`, is_error: true };
	}
	return { content: result.stdout.trim() };
}

async function opBranch(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parseBranchArguments(args);
	if (!parsed.ok) return argumentError(parsed.message);
	if (parsed.value.action === "list") {
		const result = await git(["branch", "-vv"], context);
		return { content: result.stdout.trim() || "(no branches)" };
	}
	if (parsed.value.action === "switch") {
		const result = await git(["switch", parsed.value.name], context);
		if (result.code !== 0) {
			return { content: `Error: ${result.stderr.trim()}`, is_error: true };
		}
		return {
			content: result.stderr.trim() || `Switched to ${parsed.value.name}`,
		};
	}
	if (parsed.value.action === "delete") {
		if (PROTECTED_BRANCHES.has(parsed.value.name)) {
			return {
				content: `Blocked: cannot delete protected branch '${parsed.value.name}'`,
				is_error: true,
			};
		}
		const result = await git(
			["branch", parsed.value.force ? "-D" : "-d", "--", parsed.value.name],
			context,
		);
		if (result.code !== 0) {
			return { content: `Error: ${result.stderr.trim()}`, is_error: true };
		}
		return {
			content: result.stdout.trim() || `Deleted branch ${parsed.value.name}`,
		};
	}
	const result = await git(["switch", "-c", parsed.value.name], context);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim()}`, is_error: true };
	}
	return {
		content:
			result.stderr.trim() || `Created and switched to ${parsed.value.name}`,
	};
}

async function opPush(args: string, context?: ToolRunnerContext): Promise<ToolResult> {
	const parsed = parsePushArguments(args, repoRoot(context));
	if (!parsed.ok) return argumentError(parsed.message);
	const currentBranch = await getCurrentBranch(context);
	let protectedTarget: string | null;
	try {
		protectedTarget = await protectedNonLeaseForcePushTarget(
			args,
			currentBranch,
			{
				getAll: (key) => readGitConfigValues(key, context),
				getBoolean: (key) => readGitConfigBoolean(key, context),
				getRemoteGroup: (name) => readGitRemoteGroup(name, context),
				hasRemote: (name) => hasGitRemote(name, context),
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: `Error: unable to verify push safety: ${message}`,
			is_error: true,
		};
	}
	if (protectedTarget) {
		return {
			content: `Blocked: force-push to protected branch '${protectedTarget}' is not allowed. Use --force-with-lease for safety.`,
			is_error: true,
		};
	}

	const result = await git(["push", ...parsed.value], context);
	if (result.code !== 0) {
		return { content: `Error: ${result.stderr.trim()}`, is_error: true };
	}
	return { content: result.stderr.trim() || result.stdout.trim() || "Push completed" };
}

const OPS: Record<string, (args: string, context?: ToolRunnerContext) => Promise<ToolResult>> = {
	status: opStatus,
	diff: opDiff,
	log: opLog,
	show: opShow,
	add: opAdd,
	commit: opCommit,
	branch: opBranch,
	push: opPush,
};

export async function runGit(input: Record<string, unknown>, context?: ToolRunnerContext): Promise<ToolResult> {
	const op = typeof input.op === "string" ? input.op : "";
	if (!op) return { content: "Error: op is required", is_error: true };
	const handler = OPS[op];
	if (!handler) {
		return { content: `Error: unknown op '${op}'. Valid: ${Object.keys(OPS).join(", ")}`, is_error: true };
	}
	if (input.args !== undefined && typeof input.args !== "string") {
		return { content: "Error: args must be a string", is_error: true };
	}
	return handler(input.args ?? "", context);
}
