import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const PRIORITY_ORDER = ["p0", "p1", "p2", "p3"] as const;

export type ClaimTaskResult = {
  chosenTaskId: string;
};

export function isClaimTaskResult(value: unknown): value is ClaimTaskResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "chosenTaskId" in value &&
    typeof (value as ClaimTaskResult).chosenTaskId === "string"
  );
}

function extractPriority(content: string): string {
  const match = content.match(/^priority:\s*(\S+)/m);
  return match?.[1] ?? "p3";
}

export function claimTask(projectDir: string): ClaimTaskResult | null {
  const readyDir = join(projectDir, "tasks", "ready");
  if (!existsSync(readyDir)) return null;

  const files = readdirSync(readyDir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  );
  if (files.length === 0) return null;

  let chosenFile: string | null = null;
  let chosenPriorityRank: number = PRIORITY_ORDER.length;

  for (const file of files) {
    const content = readFileSync(join(readyDir, file), "utf-8");
    const priority = extractPriority(content);
    const rank = PRIORITY_ORDER.indexOf(priority as (typeof PRIORITY_ORDER)[number]);
    const effectiveRank = rank === -1 ? PRIORITY_ORDER.length : rank;
    if (effectiveRank < chosenPriorityRank) {
      chosenPriorityRank = effectiveRank;
      chosenFile = file;
    }
  }

  if (!chosenFile) return null;

  const srcPath = join(readyDir, chosenFile);
  const doingDir = join(projectDir, "tasks", "doing");
  const dstPath = join(doingDir, chosenFile);

  const content = readFileSync(srcPath, "utf-8");
  const updated = content.replace(/^status:\s*ready$/m, "status: doing");
  writeFileSync(dstPath, updated, "utf-8");
  unlinkSync(srcPath);

  const chosenTaskId = basename(chosenFile, ".md");
  return { chosenTaskId };
}
