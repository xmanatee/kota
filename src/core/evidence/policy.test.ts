import { describe, expect, it } from "vitest";
import {
  buildEvidencePrunedReference,
  EVIDENCE_REDACTED,
  evidencePolicyForArtifact,
  evidenceRetentionDurationMsFor,
  projectEvidenceJsonObject,
  projectEvidenceText,
  projectEvidenceUrl,
  redactionProfileForTarget,
  redactSensitiveText,
  redactSensitiveValues,
  resolveEvidenceRetention,
} from "./policy.js";

describe("evidence policy", () => {
  it("declares typed retention, redaction, provenance, and append-only posture", () => {
    expect(evidencePolicyForArtifact("event-envelope")).toMatchObject({
      artifactType: "event-envelope",
      appendOnly: true,
      sensitivity: "internal",
    });
    expect(evidencePolicyForArtifact("owner-decision")).toMatchObject({
      artifactType: "owner-decision",
      appendOnly: false,
    });
    expect(evidencePolicyForArtifact("workflow-run").retention).toContainEqual({
      scope: "directory",
      state: "terminal",
      retention: { kind: "expire-after-ms", durationMs: 604800000 },
      expiredPayload: "metadata-reference",
    });
    expect(evidenceRetentionDurationMsFor({
      artifactType: "setup-status",
      state: "pending",
      scope: "directory",
    })).toBe(600000);
    expect(redactionProfileForTarget("logs-traces")).toMatchObject({
      target: "logs-traces",
      omitPrivateReasoning: true,
      omitToolIo: true,
      omitProviderPayloads: true,
    });
  });

  it("resolves retention by scope, artifact type, and state", () => {
    expect(resolveEvidenceRetention({
      artifactType: "dead-letter-item",
      state: "closed",
      scope: "directory",
      retainedFrom: new Date("2026-06-01T00:00:00.000Z"),
    })).toEqual({
      kind: "expires",
      durationMs: 1209600000,
      expiresAt: "2026-06-15T00:00:00.000Z",
      expiredPayload: "metadata-reference",
    });
    expect(resolveEvidenceRetention({
      artifactType: "event-envelope",
      state: "active",
      scope: "global",
      retainedFrom: new Date("2026-06-01T00:00:00.000Z"),
    })).toEqual({
      kind: "retain",
      expiredPayload: "exclude-from-query",
    });
  });

  it("redacts secrets, PII, provider payloads, private reasoning, and tool IO", () => {
    const projected = projectEvidenceJsonObject({
      token: "raw-token",
      email: "owner@example.test",
      providerPayload: { body: "raw provider payload" },
      thinking: "private reasoning",
      toolResult: "file contents",
      safe: "kept",
    }, "daemon-api");

    expect(projected.token).toBe(EVIDENCE_REDACTED);
    expect(projected.email).toBe(EVIDENCE_REDACTED);
    expect(projected.providerPayload).toMatchObject({
      redacted: true,
      reason: "provider-payload",
    });
    expect(projected.thinking).toMatchObject({
      redacted: true,
      reason: "private-reasoning",
    });
    expect(projected.toolResult).toMatchObject({
      redacted: true,
      reason: "tool-io",
    });
    expect(projected.safe).toBe("kept");
  });

  it("keeps token usage metadata while redacting credential tokens", () => {
    const projected = projectEvidenceJsonObject({
      accessToken: "raw-token",
      inputTokens: 12,
      outputTokens: 34,
      tokenCount: 46,
    }, "internal-storage");

    expect(projected.accessToken).toBe(EVIDENCE_REDACTED);
    expect(projected.inputTokens).toBe(12);
    expect(projected.outputTokens).toBe(34);
    expect(projected.tokenCount).toBe(46);
  });

  it("keeps secret reference metadata without exposing credential payloads", () => {
    const projected = projectEvidenceJsonObject({
      secretReference: "$DEMO_REFRESH_TOKEN",
      secretRefs: [{
        name: "DEMO_REFRESH_TOKEN",
        scope: "scope",
        source: "scope-file",
        present: true,
        token: "raw-token",
        value: "refresh-token-secret-789",
      }],
    }, "daemon-api");

    expect(projected.secretReference).toBe("$DEMO_REFRESH_TOKEN");
    expect(projected.secretRefs).toEqual([{
      name: "DEMO_REFRESH_TOKEN",
      scope: "scope",
      source: "scope-file",
      present: true,
      token: EVIDENCE_REDACTED,
      value: EVIDENCE_REDACTED,
    }]);
  });

  it("scrubs sensitive URL parameters without discarding the endpoint", () => {
    const projected = projectEvidenceJsonObject({
      url: "https://auth.example.test/start?state=secret-state&next=/setup",
    }, "daemon-api");

    expect(projected.url).toBe(
      "https://auth.example.test/start?state=%5Bredacted%5D&next=%2Fsetup",
    );
  });

  it("represents pruned payloads with retained metadata and provenance", () => {
    const ref = buildEvidencePrunedReference({
      artifactType: "workflow-run",
      id: "run-1",
      prunedAt: "2026-06-13T10:00:00.000Z",
      retained: {
        id: "run-1",
        workflow: "builder",
        status: "success",
        accessToken: "secret-token",
      },
      provenance: {
        workflowName: "builder",
        runId: "run-1",
        sourceEventIds: ["evtj-1"],
        transformedFrom: [{ artifactType: "event-envelope", id: "evtj-1" }],
      },
    });

    expect(ref).toMatchObject({
      artifactType: "workflow-run",
      id: "run-1",
      payloadExpired: true,
      provenance: {
        workflowName: "builder",
        sourceEventIds: ["evtj-1"],
      },
    });
    expect(ref.retained.accessToken).toBe(EVIDENCE_REDACTED);
  });

  it("omits private text for client targets while preserving byte counts", () => {
    expect(projectEvidenceText("private reasoning", "daemon-api", "private-reasoning")).toMatchObject({
      redacted: true,
      reason: "private-reasoning",
      bytes: 17,
    });
  });

  it("sanitizes plain diagnostic text without hiding ordinary content", () => {
    expect(
      redactSensitiveText("restart failed because secret=raw-token for owner@example.test while verification stayed readable"),
    ).toBe("restart failed because secret=[redacted] for [redacted] while verification stayed readable");
    expect(
      redactSensitiveText("callback https://auth.example.test/start?token=raw-token&next=/setup"),
    ).toBe("callback https://auth.example.test/start?token=%5Bredacted%5D&next=%2Fsetup");
    expect(redactSensitiveText("requires successful verification steps: verify")).toBe(
      "requires successful verification steps: verify",
    );
    expect(redactSensitiveText("Enter the API token")).toBe("Enter the API token");
    expect(redactSensitiveValues("Credentials were revoked")).toBe("Credentials were revoked");
    expect(redactSensitiveText("provider returned sk-adversarial-value-1234567890")).toBe(
      "provider returned [redacted]",
    );
  });

  it("sanitizes URL credentials across authority, query, and fragment components", () => {
    expect(projectEvidenceUrl(
      "https://user:password@example.test/callback?next=/setup#access_token=secret&view=ready",
      "daemon-api",
    )).toBe(
      "https://%5Bredacted%5D:%5Bredacted%5D@example.test/callback?next=/setup#access_token=%5Bredacted%5D&view=ready",
    );
  });
});
