import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readDaemonState(): { running: boolean; state: Record<string, unknown> } | null {
  const statePath = join(process.cwd(), ".kota", "daemon-state.json");
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    let running = false;
    if (state.pid && typeof state.pid === "number") {
      try {
        process.kill(state.pid, 0);
        running = true;
      } catch {
        running = false;
      }
    }
    return { running, state };
  } catch {
    return null;
  }
}
