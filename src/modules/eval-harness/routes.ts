/**
 * HTTP route that operators use to invoke the eval harness via the daemon's
 * server surface. The route accepts a typed body, validates it, kicks off the
 * run via the subprocess executor, and emits the aggregate telemetry event
 * when the run completes.
 */

import { mkdirSync, realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { ModuleContext } from "#core/modules/module-types.js";
import { runEvalSet } from "./eval-set.js";
import { evalHarnessSetCompleted } from "./events.js";
import { loadAllFixtures, loadFixture } from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";

type EvalRunRequest = {
  fixtureIds?: readonly string[];
  repeatCount?: number;
  hostClass?: string;
  cpuAllocationCores?: number;
  cpuKillThresholdCores?: number;
  memoryAllocationMB?: number;
  memoryKillThresholdMB?: number;
  keepWorkingDirs?: boolean;
};

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((s, c) => s + c.length, 0) > 64 * 1024) {
      throw new Error("Request body too large for eval run (>64KB).");
    }
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) return {};
  return JSON.parse(text);
}

function validateRequest(raw: unknown): EvalRunRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Body must be a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  const out: EvalRunRequest = {};
  if (r.fixtureIds !== undefined) {
    if (
      !Array.isArray(r.fixtureIds) ||
      !r.fixtureIds.every((id) => typeof id === "string")
    ) {
      throw new Error("fixtureIds must be an array of strings.");
    }
    out.fixtureIds = r.fixtureIds as string[];
  }
  const numericKeys: Array<keyof EvalRunRequest> = [
    "repeatCount",
    "cpuAllocationCores",
    "cpuKillThresholdCores",
    "memoryAllocationMB",
    "memoryKillThresholdMB",
  ];
  for (const key of numericKeys) {
    if (r[key] !== undefined) {
      const v = r[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        throw new Error(`${String(key)} must be a positive number.`);
      }
      (out as Record<string, unknown>)[key] = v;
    }
  }
  if (r.hostClass !== undefined) {
    if (typeof r.hostClass !== "string" || r.hostClass.length === 0) {
      throw new Error("hostClass must be a non-empty string.");
    }
    out.hostClass = r.hostClass;
  }
  if (r.keepWorkingDirs !== undefined) {
    if (typeof r.keepWorkingDirs !== "boolean") {
      throw new Error("keepWorkingDirs must be a boolean.");
    }
    out.keepWorkingDirs = r.keepWorkingDirs;
  }
  return out;
}

function buildProfile(request: EvalRunRequest): ResourceProfile {
  const cpuAllocationCores = request.cpuAllocationCores ?? 2;
  const cpuKillThresholdCores = request.cpuKillThresholdCores ?? cpuAllocationCores;
  const memoryAllocationMB = request.memoryAllocationMB ?? 4096;
  const memoryKillThresholdMB = request.memoryKillThresholdMB ?? memoryAllocationMB;
  return {
    hostClass: request.hostClass ?? "daemon",
    cpuAllocationCores,
    cpuKillThresholdCores,
    memoryAllocationMB,
    memoryKillThresholdMB,
  };
}

/**
 * Build the route registration for the eval-harness module. Called from
 * `index.ts` via `routes: (ctx) => evalHarnessRoutes(ctx)`.
 */
export function evalHarnessRoutes(ctx: ModuleContext) {
  const projectDir = ctx.cwd;
  const fixturesRoot = join(projectDir, "src/modules/eval-harness/fixtures");
  const evalRunsRoot = join(projectDir, ".kota/eval-runs");
  const kotaBinaryPath = resolve(join(projectDir, "bin/kota.mjs"));

  return [
    {
      method: "POST" as const,
      path: "/api/eval/run",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          writeJson(res, 400, { error: (err as Error).message });
          return;
        }
        let request: EvalRunRequest;
        try {
          request = validateRequest(body);
        } catch (err) {
          writeJson(res, 400, { error: (err as Error).message });
          return;
        }
        let fixtures: ReturnType<typeof loadAllFixtures>;
        try {
          fixtures = request.fixtureIds
            ? request.fixtureIds.map((id) => loadFixture(fixturesRoot, id))
            : loadAllFixtures(fixturesRoot);
        } catch (err) {
          writeJson(res, 400, { error: (err as Error).message });
          return;
        }
        if (fixtures.length === 0) {
          writeJson(res, 400, { error: `No fixtures under "${fixturesRoot}".` });
          return;
        }
        const repeatCount = request.repeatCount ?? 3;
        const profile = buildProfile(request);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const runArtifactBaseDir = join(evalRunsRoot, stamp);
        mkdirSync(runArtifactBaseDir, { recursive: true });
        const executor = createSubprocessExecutor({ kotaBinaryPath });
        try {
          const report = await runEvalSet({
            fixtures,
            executor,
            resourceProfile: profile,
            runArtifactBaseDir: realpathSync(runArtifactBaseDir),
            repeatCount,
            keepWorkingDirs: request.keepWorkingDirs ?? false,
          });
          ctx.events.emit(evalHarnessSetCompleted, {
            fixtureCount: report.aggregate.fixtureCount,
            repeatCount: report.repeatCount,
            passAtK: report.aggregate.passAtK,
            passHatK: report.aggregate.passHatK,
            hostClass: profile.hostClass,
            runArtifactBaseDir: report.runArtifactBaseDir,
            startedAt: report.startedAt,
            completedAt: report.completedAt,
          });
          writeJson(res, 200, {
            fixtureCount: report.aggregate.fixtureCount,
            repeatCount: report.repeatCount,
            passAtK: report.aggregate.passAtK,
            passHatK: report.aggregate.passHatK,
            runArtifactBaseDir: report.runArtifactBaseDir,
          });
        } catch (err) {
          writeJson(res, 500, { error: (err as Error).message });
        }
      },
    },
  ];
}
