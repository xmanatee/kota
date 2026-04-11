import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXPLORER_STATE_FILE = ".kota/explorer-state.json";

export function readLastExplorationAt(projectDir: string): string | undefined {
  const filePath = join(projectDir, EXPLORER_STATE_FILE);
  if (!existsSync(filePath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return typeof data.lastExplorationAt === "string" ? data.lastExplorationAt : undefined;
  } catch {
    return undefined;
  }
}

export function writeLastExplorationAt(projectDir: string): void {
  const filePath = join(projectDir, EXPLORER_STATE_FILE);
  writeFileSync(filePath, JSON.stringify({ lastExplorationAt: new Date().toISOString() }), "utf-8");
}
