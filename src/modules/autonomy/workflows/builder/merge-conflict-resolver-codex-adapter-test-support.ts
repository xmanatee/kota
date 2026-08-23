import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { vi } from "vitest";
import {
	type AgentHarness,
	registerAgentHarness,
} from "#core/agent-harness/index.js";

const fixtureDirs: string[] = [];

export function registerCodexAdapterFixture(
	harness: AgentHarness,
	workspaceDir: string,
): void {
	const fixtureBin = mkdtempSync(join(tmpdir(), "kota-codex-adapter-fixture-"));
	fixtureDirs.push(fixtureBin);
	const fixtureExecutable = join(fixtureBin, "codex");
	const fixtureCommonGitDir = execFileSync(
		"git",
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ cwd: workspaceDir, encoding: "utf8" },
	).trim();
	const nativeCodexExecutable = execFileSync("which", ["codex"], {
		encoding: "utf8",
	}).trim();
	writeFileSync(
		fixtureExecutable,
		`#!/usr/bin/env node
const { execFileSync, spawnSync } = require("node:child_process");
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const prompt = readFileSync(0, "utf8");
const cdIndex = process.argv.indexOf("--cd");
const cwd = cdIndex >= 0 ? process.argv[cdIndex + 1] : process.cwd();
const target = join(cwd, "settings.txt");
const fixtureGitDir = execFileSync(
  "git",
  ["rev-parse", "--absolute-git-dir"],
  { cwd, encoding: "utf8" },
).trim();
const fixtureCommonGitDir = ${JSON.stringify(fixtureCommonGitDir)};
const protectedGitProbes = [
  { operation: "create", path: fixtureGitDir },
  { operation: "append", path: join(fixtureGitDir, "HEAD") },
  { operation: "append", path: join(fixtureGitDir, "index") },
  { operation: "append", path: join(fixtureGitDir, "MERGE_HEAD") },
  { operation: "create", path: fixtureCommonGitDir },
  { operation: "append", path: join(fixtureCommonGitDir, "HEAD") },
  { operation: "append", path: join(fixtureCommonGitDir, "config") },
];
const nativeCodex = ${JSON.stringify(nativeCodexExecutable)};
const config = readFileSync(join(process.env.CODEX_HOME, "config.toml"), "utf8");

function permission(path) {
  const prefix = JSON.stringify(path) + " = ";
  const line = config.split(/\\r?\\n/).find((candidate) => candidate.startsWith(prefix));
  return line ? JSON.parse(line.slice(prefix.length)) : null;
}

function runDeniedWriteProbe(operation) {
  const result = spawnSync(nativeCodex, ["sandbox", "-P", "kota-native", "-C", cwd, process.execPath, "-e", operation], {
    cwd,
    env: {
      ...process.env,
      TARGET: target,
      PROTECTED_GIT_PROBES: JSON.stringify(protectedGitProbes),
    },
    encoding: "utf8",
  });
  if (result.status === 0) return;
  const detail = result.error ? result.error.message : result.stderr || result.stdout || "exit " + result.status;
  if (detail.includes("sandbox_apply: Operation not permitted") || /bwrap.*operation not permitted/i.test(detail)) {
    process.stderr.write("Codex native permission probe was not executed because the inherited sandbox rejected nested bootstrap.\\n");
    process.exit(78);
  }
  process.stderr.write("Codex native permission probe failed: " + detail + "\\n");
  process.exit(1);
}

const review = prompt.includes("read-only merge-resolution reviewer");
let text;
if (review) {
  if (permission(target) === "write") throw new Error("read-only review unexpectedly received workspace write access");
  runDeniedWriteProbe('const { appendFileSync } = require("node:fs"); try { appendFileSync(process.env.TARGET, "forbidden\\\\n"); process.exit(41); } catch { process.exit(0); }');
  text = JSON.stringify({
    verdict: "resolved",
    summary: "The resolution preserves branch intent while accepting the canonical setting under the Codex native sandbox.",
    taskScopeJustification: "The only edited path is the declared textual conflict.",
    pathJudgments: [{ path: "settings.txt", decision: "combine", rationale: "The reconciled value is the task-declared fixture outcome." }],
  });
} else {
  if (permission(target) !== "write") throw new Error("resolver target is not writable in the generated Codex profile");
  if (permission(fixtureGitDir) !== "read") throw new Error("physical per-worktree Git metadata is not protected from writes in the generated Codex profile");
  if (permission(fixtureCommonGitDir) !== "read") throw new Error("physical common Git metadata is not protected from writes in the generated Codex profile");
  runDeniedWriteProbe('const { appendFileSync, writeFileSync } = require("node:fs"); const probes = JSON.parse(process.env.PROTECTED_GIT_PROBES); for (const probe of probes) { try { if (probe.operation === "create") writeFileSync(require("node:path").join(probe.path, "KOTA_SANDBOX_WRITE_PROBE"), "forbidden\\\\n"); else appendFileSync(probe.path, "forbidden\\\\n"); process.exit(42); } catch {} } writeFileSync(process.env.TARGET, "value=reconciled\\\\n", "utf8");');
  text = "shipped Codex adapter resolved the conflict with both physical Git metadata roots denied by the Codex native sandbox";
}

process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "native-codex-fixture" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
`,
		"utf8",
	);
	chmodSync(fixtureExecutable, 0o755);
	vi.stubEnv("PATH", `${fixtureBin}${delimiter}${process.env.PATH ?? ""}`);
	registerAgentHarness(harness);
}

export function cleanupCodexAdapterFixtures(): void {
	for (const dir of fixtureDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}
