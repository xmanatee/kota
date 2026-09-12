import { afterEach } from "vitest";
import { clearProcesses, runProcess } from "./process.js";

export function installProcessTestHooks(): void {
  afterEach(() => clearProcesses());
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
