import { type ChildProcessByStdio, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { ClaimTaskAttempt, QueueTaskClaimResult } from "./task-claims.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const CLAIM_WORKER_SCRIPT = `
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  archiveClaimIfUnchanged,
  buildClaim,
  claimNextQueueTask,
  claimTask,
  readActiveTaskClaim,
  taskClaimPath,
  writeClaim,
} from "#modules/autonomy/task-claims.js";

const raw = process.env.KOTA_CLAIM_WORKER_INPUT;
if (!raw) throw new Error("Missing KOTA_CLAIM_WORKER_INPUT");
const input = JSON.parse(raw);
const staleClaim = input.operation === "replace-stale"
  ? readActiveTaskClaim(input.projectDir, input.taskId)
  : null;
mkdirSync(input.readyDir, { recursive: true });
writeFileSync(join(input.readyDir, input.workerId), "ready\\n", "utf8");
while (!existsSync(input.startFile)) {
  await delay(5);
}
const common = {
  projectDir: input.projectDir,
  runId: input.runId,
  workflowId: input.workflowId,
  owner: input.owner,
  workspaceDir: input.workspaceDir,
  branch: input.branch,
  baseCommit: input.baseCommit,
  leaseMs: input.leaseMs,
  now: new Date(input.now),
};
let result;
if (input.operation === "claim-task") {
  result = claimTask({
      ...common,
      taskId: input.taskId,
      taskState: input.taskState,
    });
} else if (input.operation === "claim-next") {
  result = claimNextQueueTask(common);
} else {
  if (!staleClaim) throw new Error("Missing stale claim for replacement worker");
  const now = new Date(input.now);
  const claim = buildClaim({
    ...common,
    taskId: input.taskId,
    taskState: input.taskState,
  }, now);
  if (!archiveClaimIfUnchanged(input.projectDir, taskClaimPath(input.projectDir, input.taskId), staleClaim, now)) {
    result = {
      claimed: false,
      taskId: input.taskId,
      claim: null,
      recoveryStatus: null,
      safeToRetry: false,
      recoveryPath: "write-conflict",
      reason: "claim changed during stale recovery",
    };
  } else {
    writeClaim(taskClaimPath(input.projectDir, input.taskId), claim, "wx");
    result = {
      claimed: true,
      taskId: input.taskId,
      claim,
      recoveryStatus: "agent-running",
      safeToRetry: false,
      recoveryPath: staleClaim.status === "expired" ? "replaced-expired-claim" : "replaced-stale-claim",
      reason: null,
    };
  }
}
process.stdout.write(JSON.stringify(result));
`;

export type ClaimWorkerResult = ClaimTaskAttempt | QueueTaskClaimResult;

export type ClaimWorkerInput = {
  operation: "claim-task" | "claim-next" | "replace-stale";
  workerId: string;
  readyDir: string;
  startFile: string;
  projectDir: string;
  taskId?: string;
  taskState?: "ready";
  runId: string;
  workflowId: string;
  owner: string;
  workspaceDir: string;
  branch: string;
  baseCommit: string;
  leaseMs: number;
  now: string;
};

export function makeProject(): string {
  const dir = join(tmpdir(), `kota-task-claims-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data/tasks", state), { recursive: true });
  }
  return dir;
}

export function writeTask(projectDir: string, state: string, id: string, updatedAt: string, extra = ""): void {
  writeFileSync(
    join(projectDir, "data/tasks", state, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      `status: ${state}`,
      "priority: p1",
      "area: autonomy",
      "task_class: Platform",
      "summary: Test task.",
      `updated_at: ${updatedAt}`,
      extra,
      "---",
      "",
      "## Problem",
      "",
      "Test.",
      "",
    ].filter((line) => line !== "").join("\n"),
    "utf8",
  );
}

export function claimInput(projectDir: string, taskId: string, runId: string, now: Date) {
  return {
    projectDir,
    taskId,
    taskState: "ready" as const,
    runId,
    workflowId: "builder",
    owner: `workflow:builder:${runId}`,
    workspaceDir: join(projectDir, ".worktrees", runId),
    branch: `kota/task/${taskId}/${runId}`,
    baseCommit: "base-commit",
    leaseMs: 60_000,
    now,
  };
}

export function queueInput(projectDir: string, runId: string, now: Date) {
  return {
    projectDir,
    runId,
    workflowId: "builder",
    owner: `workflow:builder:${runId}`,
    workspaceDir: join(projectDir, ".worktrees", runId),
    branch: `kota/task/${runId}`,
    baseCommit: "base-commit",
    leaseMs: 60_000,
    now,
  };
}

export function makeClaimRaceBarrier(
  projectDir: string,
  name: string,
): Pick<ClaimWorkerInput, "readyDir" | "startFile"> {
  const dir = join(projectDir, ".claim-races", name);
  return {
    readyDir: join(dir, "ready"),
    startFile: join(dir, "start"),
  };
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await delay(10);
  }
}

function spawnClaimWorker<T extends ClaimWorkerResult>(
  input: ClaimWorkerInput,
): {
  child: ChildProcessByStdio<null, Readable, Readable>;
  readyPath: string;
  result: Promise<T>;
} {
  const child = spawn(
    process.execPath,
    ["--conditions=source", "--import", "tsx", "-e", CLAIM_WORKER_SCRIPT],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        KOTA_CLAIM_WORKER_INPUT: JSON.stringify(input),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const result = new Promise<T>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claim worker ${input.workerId} exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(new Error(`claim worker ${input.workerId} returned invalid JSON: ${stdout}`));
      }
    });
  });
  result.catch(() => undefined);

  return {
    child,
    readyPath: join(input.readyDir, input.workerId),
    result,
  };
}

export async function runConcurrentClaimWorkers<T extends ClaimWorkerResult>(
  inputs: ClaimWorkerInput[],
): Promise<T[]> {
  const workers = inputs.map((input) => spawnClaimWorker<T>(input));
  try {
    await Promise.all(workers.map((worker) => waitForFile(worker.readyPath)));
    writeFileSync(inputs[0]!.startFile, "start\n", "utf8");
    return await Promise.all(workers.map((worker) => worker.result));
  } catch (error) {
    for (const worker of workers) worker.child.kill();
    await Promise.allSettled(workers.map((worker) => worker.result));
    throw error;
  }
}
