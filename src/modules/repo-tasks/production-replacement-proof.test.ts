import { describe, expect, it } from "vitest";
import { parseProductionReplacementDeclaration } from "./production-replacement-proof.js";
import {
  REPLACEMENT_ENTRYPOINT_PATHS,
  REPLACEMENT_EVIDENCE_PATH,
  REPLACEMENT_OWNER,
  REPLACEMENT_TEST_PATHS,
  replacementDeclaration,
} from "./production-replacement-proof.test-helpers.js";

describe("production replacement declaration", () => {
  it("parses a task-authored declaration without copying runtime catalogs", () => {
    expect(parseProductionReplacementDeclaration(replacementDeclaration())).toEqual({
      kind: "valid",
      declaration: {
        oldBoundary: "legacy runtime ingress",
        replacementOwner: REPLACEMENT_OWNER,
        liveIngresses: ["daemon startup", "live event delivery"],
        restartIngresses: ["persisted queue restore"],
        observableEffect: "the new owner receives live and restored traffic",
        productionEntrypoints: [...REPLACEMENT_ENTRYPOINT_PATHS],
        productionTests: [...REPLACEMENT_TEST_PATHS],
        retiredPathCheck: "legacy ingress is unreachable from live and restored state",
        evidenceArtifact: REPLACEMENT_EVIDENCE_PATH,
      },
    });
  });

  it("rejects incomplete, unknown, duplicate, and unsafe declaration fields", () => {
    expect(
      parseProductionReplacementDeclaration(
        replacementDeclaration({ evidenceArtifact: "../outside.json" }),
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("repo-relative") });
    expect(
      parseProductionReplacementDeclaration(
        replacementDeclaration({
          evidenceArtifact: ".kota/builder-evidence/run/artifacts/proof.json",
        }),
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("durable projected") });
    expect(
      parseProductionReplacementDeclaration(
        replacementDeclaration().replace("oldBoundary:", "unknownBoundary:"),
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("unknown field") });
    expect(
      parseProductionReplacementDeclaration(
        `${replacementDeclaration()}\noldBoundary: duplicate`,
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("more than once") });
    expect(
      parseProductionReplacementDeclaration(
        replacementDeclaration({ productionEntrypoints: "src/fake.test.ts" }),
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("non-test") });
    expect(
      parseProductionReplacementDeclaration(
        replacementDeclaration().replace(/^restartIngresses:.*\n/m, ""),
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("restartIngresses") });
  });
});
