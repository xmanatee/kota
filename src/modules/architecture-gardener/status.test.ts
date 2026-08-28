
import { describe, expect, it } from "vitest";
import { buildArchitectureGardenerStatus, formatGardenerStatusTerminal } from "./status.js";
import type { ArchitectureGardenerRunState, ArchitectureObservation } from "./types.js";

describe("Architecture Gardener Status & CLI Formatting", () => {
  it("buildArchitectureGardenerStatus aggregates summary metrics correctly", () => {
    const observations: ArchitectureObservation[] = [
      {
        id: "o1",
        kind: "forbidden-core-to-module-dependency",
        category: "dependency-boundary",
        targetScope: "src/core/router.ts",
        summary: "forbidden import",
        fingerprint: "fp1",
        evidence: {},
        timestamp: "now",
      },
      {
        id: "o2",
        kind: "module-dependency-cycle",
        category: "dependency-boundary",
        targetScope: "module:a",
        summary: "cycle",
        fingerprint: "fp2",
        evidence: {},
        timestamp: "now",
      },
    ];

    const state: ArchitectureGardenerRunState = {
      schemaVersion: 1,
      updatedAt: "now",
      lastRunId: "run-1",
      fingerprints: {},
      dispositions: {
        "src/core/router.ts": {
          targetScope: "src/core/router.ts",
          disposition: "accepted",
          reason: "Structural violation",
          decidedAt: "now",
        },
        "module:b": {
          targetScope: "module:b",
          disposition: "cooled_down",
          reason: "On cooldown",
          decidedAt: "now",
        },
      },
      cooldowns: {},
    };

    const status = buildArchitectureGardenerStatus({
      repoRoot: process.cwd(),
      stateDir: "/tmp/state",
      currentObservations: observations,
      state,
    });

    expect(status.summary.totalObservations).toBe(2);
    expect(status.summary.observationsByKind["forbidden-core-to-module-dependency"]).toBe(1);
    expect(status.summary.acceptedCount).toBe(1);
    expect(status.summary.cooledDownCount).toBe(1);

    const formatted = formatGardenerStatusTerminal(status);
    expect(formatted).toContain("Architecture Gardener Status");
    expect(formatted).toContain("Total Observations: 2");
    expect(formatted).toContain("[ACCEPTED] src/core/router.ts");
    expect(formatted).toContain("[COOLED_DOWN] module:b");
  });
});
