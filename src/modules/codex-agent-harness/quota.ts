import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { buildNativeCliEnvironment } from "#core/agent-harness/native-cli-environment.js";
import type { ReadWeeklyQuota, WeeklyQuotaSnapshot } from "#core/agent-harness/quota.js";
import { resolveCodexHome } from "./runtime-home.js";

const windowSchema = z.object({
  usedPercent: z.number().finite().min(0).max(100),
  windowDurationMins: z.number().int().positive(),
  resetsAt: z.number().int().positive(),
});
const bucketSchema = z.object({
  limitId: z.string().nullable().optional(),
  primary: windowSchema.nullish(),
  secondary: windowSchema.nullish(),
});
const limitsSchema = z.object({
  rateLimits: bucketSchema.optional(),
  rateLimitsByLimitId: z.record(z.string(), bucketSchema).nullish(),
});

export function decodeCodexWeeklyQuota(value: unknown): WeeklyQuotaSnapshot {
  const result = limitsSchema.parse(value);
  const bucket = result.rateLimitsByLimitId != null
    ? result.rateLimitsByLimitId.codex
    : result.rateLimits?.limitId === "codex" || result.rateLimits?.limitId == null
      ? result.rateLimits
      : undefined;
  const weekly = [bucket?.primary, bucket?.secondary]
    .filter((window) => window?.windowDurationMins === 10_080);
  if (weekly.length !== 1 || !weekly[0]) {
    throw new Error("Codex did not report one authoritative weekly account quota window");
  }
  return { usedPercent: weekly[0].usedPercent, resetsAt: weekly[0].resetsAt };
}

/** Account RPC only: no thread, turn, model inference, or reset-credit consumption. */
export const readCodexWeeklyQuota: ReadWeeklyQuota = async (signal) => {
  signal.throwIfAborted();
  return new Promise<WeeklyQuotaSnapshot>((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--stdio", "--disable", "plugins", "--disable", "hooks"], {
      cwd: resolveCodexHome(process.env),
      env: {
        ...buildNativeCliEnvironment({ blockedEnvKeys: ["OPENAI_API_KEY"] }),
        CODEX_HOME: resolveCodexHome(process.env),
      },
      stdio: ["pipe", "pipe", "ignore"],
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    let result: WeeklyQuotaSnapshot | undefined;
    let failure: Error | undefined;
    let stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.stdin.end();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      killTimer.unref();
    };
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on("error", (error) => { failure = error; stop(); });
    child.stdin.on("error", (error) => { failure ??= error; stop(); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (stopping) return;
      try {
        const message = z.object({
          id: z.number().optional(),
          result: z.unknown().optional(),
          error: z.unknown().optional(),
        }).parse(JSON.parse(line));
        if (message.id !== 1 && message.id !== 2) return;
        if (message.error !== undefined) throw new Error(`Codex account RPC ${message.id} failed`);
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "account/rateLimits/read", params: {} });
        } else {
          result = decodeCodexWeeklyQuota(message.result);
          stop();
        }
      } catch (error) {
        failure = new Error(`Codex quota response rejected: ${error instanceof Error ? error.message : "invalid response"}`);
        stop();
      }
    });
    child.on("close", () => {
      if (killTimer) clearTimeout(killTimer);
      lines.close();
      if (failure) reject(failure);
      else if (result) resolve(result);
      else reject(new Error("Codex quota process exited before returning account limits"));
    });
    send({ id: 1, method: "initialize", params: {
      clientInfo: { name: "kota_quota_guard", version: "1.0.0" },
      capabilities: {},
    } });
  });
};
