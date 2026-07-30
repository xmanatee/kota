import { describe, expect, it } from "vitest";
import {
  mapDaemonSseEvent,
  permissionDecisionBody,
} from "./daemon-adapter-sse.js";

describe("ACP daemon approval bridge", () => {
  it("carries safe context and the review digest into the permission request", () => {
    const digest = "a".repeat(64);
    const mapped = mapDaemonSseEvent("session-1", {
      event: "approval_request",
      data: JSON.stringify({
        approval_id: "approval-1",
        tool_use_id: "tool-1",
        tool: "shell",
        input: { command: "deploy", path: "/srv/app" },
        risk: "dangerous",
        reason: "writes external state",
        timeout_ms: 120_000,
        context: "User: deploy /srv/app",
        review_digest: digest,
      }),
    });

    expect(mapped).toEqual({
      kind: "approval",
      request: {
        approvalId: "approval-1",
        toolUseId: "tool-1",
        tool: "shell",
        input: { command: "deploy", path: "/srv/app" },
        risk: "dangerous",
        reason: "writes external state",
        timeoutMs: 120_000,
        context: "User: deploy /srv/app",
        reviewDigest: digest,
      },
    });
    expect(permissionDecisionBody({ outcome: "allow" }, digest)).toEqual({
      outcome: "allow",
      review_digest: digest,
    });
  });

  it("rejects malformed daemon review digests", () => {
    expect(() => mapDaemonSseEvent("session-1", {
      event: "approval_request",
      data: JSON.stringify({
        approval_id: "approval-1",
        tool_use_id: "tool-1",
        tool: "shell",
        input: { command: "deploy" },
        risk: "dangerous",
        reason: "writes external state",
        timeout_ms: 120_000,
        review_digest: "not-a-digest",
      }),
    })).toThrow("approval.review_digest must be a sha256 digest");
  });
});
