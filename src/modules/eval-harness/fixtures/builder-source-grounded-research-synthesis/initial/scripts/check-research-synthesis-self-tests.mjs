class ShortcutCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShortcutCheckError";
  }
}

function sourceCatalogFixture() {
  return new Map([
    [
      "archival-cloud-ocr-2025-11",
      {
        id: "archival-cloud-ocr-2025-11",
        path: "research/packet/source-2025-11-cloud-ocr-archive.md",
      },
    ],
    [
      "partner-roadmap-2026-04",
      {
        id: "partner-roadmap-2026-04",
        path: "research/packet/source-2026-04-partner-roadmap.md",
      },
    ],
    [
      "lab-benchmark-2026-05",
      {
        id: "lab-benchmark-2026-05",
        path: "research/packet/source-2026-05-lab-benchmark.md",
      },
    ],
    [
      "security-review-2026-06",
      {
        id: "security-review-2026-06",
        path: "research/packet/source-2026-06-security-review.md",
      },
    ],
    [
      "pilot-results-2026-06",
      {
        id: "pilot-results-2026-06",
        path: "research/packet/source-2026-06-production-pilot.md",
      },
    ],
  ]);
}

function validArtifactFixture(params) {
  return {
    schemaVersion: 1,
    decisionId: params.decisionId,
    selectedDecision: "local-first-markdown",
    citedSources: [
      {
        id: "security-review-2026-06",
        path: "research/packet/source-2026-06-security-review.md",
        claim:
          "Security blocks external OCR for customer-ticket payloads in the Q3 offline release.",
      },
      {
        id: "pilot-results-2026-06",
        path: "research/packet/source-2026-06-production-pilot.md",
        claim:
          "The local-first markdown parser met release thresholds and Cloud OCR failed the offline canary.",
      },
    ],
    rejectedSources: [
      {
        id: "archival-cloud-ocr-2025-11",
        path: "research/packet/source-2025-11-cloud-ocr-archive.md",
        reason:
          "Stale guidance superseded by the later security review and production pilot.",
      },
      {
        id: "partner-roadmap-2026-04",
        path: "research/packet/source-2026-04-partner-roadmap.md",
        reason: "Speculative unshipped offline cache, not current release evidence.",
      },
      {
        id: "lab-benchmark-2026-05",
        path: "research/packet/source-2026-05-lab-benchmark.md",
        reason: "Narrow benchmark conflicts with the offline and privacy constraints.",
      },
    ],
    conflictResolution: {
      summary:
        "The security review and pilot are decisive release evidence, so they resolve the conflict against stale, speculative, and narrow Cloud OCR notes.",
      winningEvidence: ["security-review-2026-06", "pilot-results-2026-06"],
      losingEvidence: [
        "archival-cloud-ocr-2025-11",
        "partner-roadmap-2026-04",
        "lab-benchmark-2026-05",
      ],
    },
    verificationCommand: params.verificationCommand,
    objectiveMetrics: {
      sourceDisciplineScore: 1,
      decisiveSourceCitations: 2,
      rejectedStaleSources: 1,
      conflictsAddressed: 1,
    },
  };
}

function expectFailure(name, fn, expectedNeedle) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedNeedle)) {
      throw new ShortcutCheckError(`${name} failed for the wrong reason: ${message}`);
    }
    return;
  }
  throw new ShortcutCheckError(`${name} unexpectedly passed`);
}

export function runShortcutSelfTests(params) {
  const catalog = sourceCatalogFixture();
  const valid = () => validArtifactFixture(params);
  params.validateArtifact(valid(), catalog);

  expectFailure(
    "prose-only artifact",
    () => params.validateArtifact("local markdown wins", catalog),
    "JSON object",
  );

  expectFailure(
    "invented citation id",
    () =>
      params.validateArtifact(
        {
          ...valid(),
          citedSources: [
            ...valid().citedSources,
            {
              id: "invented-2026-06",
              path: "research/packet/invented.md",
              claim: "looks good",
            },
          ],
        },
        catalog,
      ),
    "unknown source id",
  );

  expectFailure(
    "stale-source-only decision",
    () =>
      params.validateArtifact(
        {
          ...valid(),
          selectedDecision: "cloud-ocr",
          citedSources: [
            {
              id: "archival-cloud-ocr-2025-11",
              path: "research/packet/source-2025-11-cloud-ocr-archive.md",
              claim: "The archived note preferred Cloud OCR.",
            },
          ],
        },
        catalog,
      ),
    "selectedDecision",
  );

  expectFailure(
    "conflict omission",
    () =>
      params.validateArtifact(
        {
          ...valid(),
          conflictResolution: {
            summary: "The selected option is newer and seems practical.",
            winningEvidence: ["security-review-2026-06", "pilot-results-2026-06"],
            losingEvidence: [
              "archival-cloud-ocr-2025-11",
              "partner-roadmap-2026-04",
              "lab-benchmark-2026-05",
            ],
          },
        },
        catalog,
      ),
    "conflict",
  );

  expectFailure(
    "source packet edit",
    () =>
      params.validateChangedPaths([
        params.resultPath,
        "research/packet/source-2026-06-security-review.md",
      ]),
    "changed path",
  );

  expectFailure(
    "verifier edit",
    () =>
      params.validateChangedPaths([
        params.resultPath,
        "scripts/check-research-synthesis.mjs",
        "scripts/check-research-synthesis-self-tests.mjs",
      ]),
    "changed path",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        checkedShortcuts: [
          "prose-only-artifact",
          "invented-citation-id",
          "stale-source-only-decision",
          "conflict-omission",
          "source-packet-edit",
          "verifier-edit",
        ],
      },
      null,
      2,
    ),
  );
}
