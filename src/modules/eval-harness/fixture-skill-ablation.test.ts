import { mkdtempSync, rmSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadFixture,
} from "./fixture.js";
import {
  skillAblationFixtureSpec,
  skillAblationSpec,
  skillAblationVariant,
  writeFixture,
} from "./fixture-test-support.js";

describe("loadFixture skill-ablation specs", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads a well-formed skill-ablation fixture", () => {
    writeFixture(root, "skillAblation", skillAblationFixtureSpec());

    const loaded = loadFixture(root, "skillAblation");
    const spec = skillAblationSpec(loaded);

    expect(spec.mode).toBe("skill-ablation");
    expect(spec.variants.map((variant) => variant.id)).toEqual([
      "control",
      "focused",
      "noisy",
    ]);
    expect(spec.variants[0].selectedSkills).toEqual([]);
    expect(spec.variants[1].selectedSkills).toEqual(["ticket-json-procedure"]);
    expect(spec.expectedDirection).toMatchObject({
      controlVariantId: "control",
      treatmentVariantId: "focused",
      noisyVariantId: "noisy",
    });
  });

  it("rejects skill-ablation fixtures without a no-skill control", () => {
    writeFixture(
      root,
      "skillAblation",
      skillAblationFixtureSpec({
        variants: [
          skillAblationVariant({
            id: "focused",
            selectedSkills: ["ticket-json-procedure"],
            skillProvenance: "imported",
            expectedOutcome: "pass",
          }),
          skillAblationVariant({
            id: "noisy",
            selectedSkills: ["outdated-ticket-procedure"],
            skillProvenance: "imported",
          }),
        ],
      }),
    );

    expect(() => loadFixture(root, "skillAblation")).toThrow(/no-skill control/);
  });

  it("rejects skill-ablation fixtures without an explicit-skill treatment", () => {
    writeFixture(
      root,
      "skillAblation",
      skillAblationFixtureSpec({
        variants: [
          skillAblationVariant({
            id: "control",
            selectedSkills: [],
            skillProvenance: "none",
          }),
          skillAblationVariant({
            id: "other-control",
            selectedSkills: [],
            skillProvenance: "none",
          }),
        ],
      }),
    );

    expect(() => loadFixture(root, "skillAblation")).toThrow(
      /explicit-skill treatment/,
    );
  });

  it("rejects duplicate skill-ablation variant ids", () => {
    writeFixture(
      root,
      "skillAblation",
      skillAblationFixtureSpec({
        variants: [
          skillAblationVariant({
            id: "control",
            selectedSkills: [],
            skillProvenance: "none",
          }),
          skillAblationVariant({
            id: "control",
            selectedSkills: ["ticket-json-procedure"],
            skillProvenance: "imported",
            expectedOutcome: "pass",
          }),
        ],
      }),
    );

    expect(() => loadFixture(root, "skillAblation")).toThrow(/duplicate/);
  });

  it("rejects skill-ablation variant ids that are not safe path components", () => {
    const unsafeIds = [
      "../escape",
      "nested/escape",
      "nested\\escape",
      "/tmp/escape",
      "C:\\escape",
      ".",
      "..",
    ];

    for (const [index, unsafeId] of unsafeIds.entries()) {
      const fixtureId = `skillAblationUnsafe${index}`;
      writeFixture(
        root,
        fixtureId,
        skillAblationFixtureSpec({
          id: fixtureId,
          variants: [
            skillAblationVariant({
              id: unsafeId,
              selectedSkills: [],
              skillProvenance: "none",
            }),
            skillAblationVariant({
              id: "focused",
              selectedSkills: ["ticket-json-procedure"],
              skillProvenance: "imported",
              expectedOutcome: "pass",
            }),
          ],
          expectedDirection: {
            kind: "treatment-passes-control-fails",
            controlVariantId: unsafeId,
            treatmentVariantId: "focused",
            summary: "Unsafe control id should be rejected before scoring.",
          },
        }),
      );

      let caught: Error | null = null;
      try {
        loadFixture(root, fixtureId);
      } catch (err) {
        caught = err instanceof Error ? err : new Error(String(err));
      }
      expect(caught, `unsafe variant id ${JSON.stringify(unsafeId)}`).toBeInstanceOf(
        Error,
      );
      expect(caught?.message).toMatch(/safe single path component/);
    }
  });

  it("rejects skill-ablation expectedDirection references that do not match variant roles", () => {
    writeFixture(
      root,
      "skillAblation",
      skillAblationFixtureSpec({
        expectedDirection: {
          kind: "treatment-passes-control-fails",
          controlVariantId: "focused",
          treatmentVariantId: "control",
          summary: "Incorrectly reversed direction.",
        },
      }),
    );

    expect(() => loadFixture(root, "skillAblation")).toThrow(
      /controlVariantId must reference a no-skill control/,
    );
  });

  it("rejects skill-ablation expectedDirection references to unknown variants", () => {
    writeFixture(
      root,
      "skillAblation",
      skillAblationFixtureSpec({
        expectedDirection: {
          kind: "treatment-passes-control-fails",
          controlVariantId: "control",
          treatmentVariantId: "missing",
          summary: "Unknown treatment.",
        },
      }),
    );

    expect(() => loadFixture(root, "skillAblation")).toThrow(/unknown/);
  });
});
