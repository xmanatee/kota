import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { DIFF_TAIL_LIMIT, TRACE_TAIL_LIMIT } from "./runner-constants.js";
import type {
  CollectingWriter,
  PreviewArtifactResult,
  VerificationResult,
} from "./runner-types.js";
import type {
  LoadedScenario,
  ScenarioVerification,
} from "./scenario.js";

export type MaterializedWorkingDir = {
  workingDir: string;
  cleanupDir: string;
};

export function createCollectingWriter(): CollectingWriter {
  const chunks: string[] = [];
  return {
    write(text: string): boolean {
      chunks.push(text);
      return true;
    },
    collected(): string {
      return chunks.join("");
    },
  };
}

export function materializeWorkingDir(
  scenario: LoadedScenario,
): MaterializedWorkingDir {
  const cleanupDir = mkdtempSync(
    join(tmpdir(), `kota-harness-parity-${scenario.spec.id}-`),
  );
  writeFileSync(join(cleanupDir, "package.json"), '{"type":"commonjs"}\n');
  const workingDir = join(cleanupDir, "working");
  cpSync(scenario.initialStateDir, workingDir, { recursive: true });
  return { workingDir, cleanupDir };
}

export function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated ...]\n${text.slice(-limit)}`;
}

export function runVerification(
  workingDir: string,
  verification: ScenarioVerification,
): VerificationResult {
  const result = spawnSync(verification.command, {
    shell: true,
    cwd: workingDir,
    env: withProtectedGitBareRepositoryEnv(),
    timeout: verification.timeoutMs,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const timedOut =
    result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT") === true;
  const passed = !timedOut && result.status === 0;
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    command: verification.command,
    timeoutMs: verification.timeoutMs,
    passed,
    exitStatus: result.status ?? null,
    timedOut,
    output: tail(combined, TRACE_TAIL_LIMIT),
  };
}

export function capturePreviewArtifacts(args: {
  workingDir: string;
  artifactDir: string;
  previewArtifacts: readonly string[];
}): PreviewArtifactResult[] {
  const results: PreviewArtifactResult[] = [];
  for (const sourcePath of args.previewArtifacts) {
    const source = join(args.workingDir, sourcePath);
    const artifactPath = join(args.artifactDir, sourcePath);
    if (!existsSync(source)) {
      results.push({
        sourcePath,
        artifactPath,
        preserved: false,
        reason: "missing",
      });
      continue;
    }
    if (!statSync(source).isFile()) {
      results.push({
        sourcePath,
        artifactPath,
        preserved: false,
        reason: "not_file",
      });
      continue;
    }

    mkdirSync(dirname(artifactPath), { recursive: true });
    cpSync(source, artifactPath);
    results.push({ sourcePath, artifactPath, preserved: true });
  }
  return results;
}

/**
 * Compute a git-style diff of the working directory vs the scenario initial
 * tree. The two trees are placed under a shared parent so git diff renders
 * paths as `a/initial/...` vs `b/working/...`, keeping the output stable
 * regardless of where the real directories live.
 */
export function computeDiff(initialDir: string, workingDir: string): {
  diff: string;
  changedFiles: string[];
} {
  const pairDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-pair-"));
  const initialLink = join(pairDir, "initial");
  const workingLink = join(pairDir, "working");
  cpSync(initialDir, initialLink, { recursive: true });
  cpSync(workingDir, workingLink, { recursive: true });

  const diffResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-color",
      "--unified=3",
      "initial",
      "working",
    ],
    {
      cwd: pairDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const diffCombined = [diffResult.stdout, diffResult.stderr]
    .filter(Boolean)
    .join("\n");

  const namesResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--name-only",
      "initial",
      "working",
    ],
    {
      cwd: pairDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const changed = new Set<string>();
  for (const line of (namesResult.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const stripped = trimmed.startsWith("working/")
      ? trimmed.slice("working/".length)
      : trimmed.startsWith("initial/")
        ? trimmed.slice("initial/".length)
        : trimmed;
    if (stripped.length > 0) changed.add(stripped);
  }

  rmSync(pairDir, { recursive: true, force: true });

  return {
    diff: tail(diffCombined, DIFF_TAIL_LIMIT),
    changedFiles: [...changed].sort(),
  };
}
