import { spawn } from "node:child_process";
import { addAbortListener } from "node:events";
import { createInterface } from "node:readline";
import { z } from "zod";
import { buildNativeCliEnvironment } from "#core/agent-harness/native-cli-environment.js";
import { NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS, signalNativeCliProcessGroup } from "#core/agent-harness/native-cli-process-group.js";
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
  const home = resolveCodexHome(process.env);
  const child = spawn("codex", ["app-server", "--stdio", "--disable", "plugins", "--disable", "hooks"], {
    cwd: home,
    env: { ...buildNativeCliEnvironment({ blockedEnvKeys: ["OPENAI_API_KEY"] }), CODEX_HOME: home },
    ...NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const lines = createInterface({ input: child.stdout });
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
  let cancellation: Disposable | undefined;
  try {
    return await new Promise<WeeklyQuotaSnapshot>((resolve, reject) => {
      cancellation = addAbortListener(signal, () => reject(signal.reason));
      child.once("error", reject);
      child.stdin.once("error", reject);
      child.once("close", () => reject(new Error("Codex quota process exited before returning account limits")));
      lines.on("line", (line) => {
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
            resolve(decodeCodexWeeklyQuota(message.result));
          }
        } catch (error) {
          reject(error);
        }
      });
      send({ id: 1, method: "initialize", params: {
        clientInfo: { name: "kota_quota_guard", version: "1.0.0" },
        capabilities: {},
      } });
    });
  } finally {
    cancellation?.[Symbol.dispose]();
    lines.close();
    child.stdin.destroy();
    // This read-only probe has no agent work to drain; use the shared group cleanup.
    signalNativeCliProcessGroup(child, "SIGKILL");
    await closed;
  }
};
