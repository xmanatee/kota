import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { emptyGardenerRunState } from "./gardener-state.js";
import { buildArchitectureGardenerStatus, formatGardenerStatusTerminal } from "./status.js";

it("renders proposed benefits as unverified and does not list unrelated generated work", () => {
  const root = mkdtempSync(join(tmpdir(), "gardener-status-"));
  try {
    const status = buildArchitectureGardenerStatus({ repoRoot: root, stateDir: join(root, ".kota"), state: {
      ...emptyGardenerRunState(), dispositions: { repo: {
        targetScope: "repo", disposition: "proposed", reason: "Two consumers maintain the same boundary.",
        decidedAt: "2026-09-09", taskId: null,
      } },
    } });
    expect(formatGardenerStatusTerminal(status)).toContain("Proposals are unverified expectations");
    expect(formatGardenerStatusTerminal(status)).toContain("[PROPOSED] repo");
    expect(status.activeTasks).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
