import { afterEach, beforeEach } from "vitest";
import { clearProcesses, runProcess } from "./process.js";

const envKeys = [
  "KOTA_SESSION_ID",
  "KOTA_TOOL_USE_ID",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_ENDPOINT",
] as const;

let savedEnv: Partial<Record<(typeof envKeys)[number], string>>;

export const envProbeCommand =
  "printf '%s|%s|%s|%s' " +
  "\"${KOTA_SESSION_ID-missing}\" " +
  "\"${KOTA_TOOL_USE_ID-missing}\" " +
  "\"${OTEL_EXPORTER_OTLP_ENDPOINT-missing}\" " +
  "\"${OTLP_ENDPOINT-missing}\"";

export function installProcessTestHooks(): void {
  beforeEach(() => {
    savedEnv = {};
    for (const key of envKeys) savedEnv[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearProcesses();
  });
}

export async function waitForExit(processId: string, maxWaitMs = 5000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await runProcess({ action: "output", process_id: processId });
    if (result.content?.includes("exited")) return result.content;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const result = await runProcess({ action: "output", process_id: processId });
  return result.content ?? "";
}
