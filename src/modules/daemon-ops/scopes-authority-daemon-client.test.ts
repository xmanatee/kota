import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createScopeAuthorityOperatorTokenVerifier,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
  SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER,
  type ScopeAuthorityOperatorTokenVerifier,
} from "#core/daemon/scope-authority-operator-token.js";
import daemonOpsModule from "./index.js";
import {
  jsonResponse,
  makeRecordingTransport,
} from "./scopes-daemon-client-test-support.js";

async function withInteractiveOperator<T>(
  operation: (verifier: ScopeAuthorityOperatorTokenVerifier) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "kota-scopes-client-"));
  const tokenPath = join(root, "operator-token.json");
  writeFileSync(tokenPath, JSON.stringify({ schema: 1, token: "a".repeat(64) }), {
    mode: 0o600,
  });
  const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
  const priorSessionId = process.env.KOTA_SESSION_ID;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = tokenPath;
  delete process.env.KOTA_SESSION_ID;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    return await operation(createScopeAuthorityOperatorTokenVerifier());
  } finally {
    if (ttyDescriptor === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    if (priorTokenPath === undefined) {
      delete process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
    } else {
      process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = priorTokenPath;
    }
    if (priorSessionId === undefined) delete process.env.KOTA_SESSION_ID;
    else process.env.KOTA_SESSION_ID = priorSessionId;
    rmSync(root, { recursive: true, force: true });
  }
}

describe("daemon-ops scopes authority client", () => {
  it("routes authority inspection, validation, and apply through typed scope endpoints", async () => {
    let operatorVerifier: ScopeAuthorityOperatorTokenVerifier | undefined;
    const { transport, calls } = makeRecordingTransport((path, init) => {
      if (path === SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH) {
        const headers = init?.headers as Record<string, string>;
        return jsonResponse(200, {
          proof: operatorVerifier?.answerChallenge(
            headers[SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER] ?? "",
          ),
        });
      }
      if (path.endsWith("/authority/validate")) {
        return jsonResponse(409, {
          ok: false,
          reason: "parent_policy_conflict",
          scopeId: "p1",
          message: "parent denies widening",
          conflict: { parentScopeId: "global", area: "autonomy" },
        });
      }
      if (path.endsWith("/authority")) {
        const authority = {
          scopeId: "p1",
          directoryRoot: "/tmp/p1",
          revision: 2,
          trust: { trusted: true, source: "machine-config" },
          policyFragment: null,
          resolvedPolicy: {},
          audit: [],
        };
        return jsonResponse(200, init?.method === "PUT"
          ? { ok: true, status: "applied", authority }
          : authority);
      }
      return jsonResponse(500, {});
    });
    const scopes = daemonOpsModule.daemonClient!(transport).scopes!;
    const mutation = {
      expectedRevision: 2,
      reason: "Operator test",
      trust: false,
    };

    await expect(scopes.inspectAuthority!("p1")).resolves.toMatchObject({
      ok: true,
      authority: { scopeId: "p1", revision: 2 },
    });
    await expect(scopes.validateAuthority!("p1", mutation)).resolves.toMatchObject({
      ok: false,
      reason: "parent_policy_conflict",
    });
    await withInteractiveOperator((verifier) => {
      operatorVerifier = verifier;
      return expect(
        scopes.applyAuthority!("p1", mutation, "confirm-dangerous"),
      ).resolves.toMatchObject({
        ok: true,
        authority: { scopeId: "p1", revision: 2 },
      });
    });

    expect(calls.map((call) => [call.init?.method, call.path])).toEqual([
      ["GET", "/scopes/p1/authority"],
      ["POST", "/scopes/p1/authority/validate"],
      ["POST", SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH],
      ["PUT", "/scopes/p1/authority"],
    ]);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual(mutation);
    expect(JSON.parse(String(calls[3]!.init?.body))).toEqual(mutation);
    expect(calls[3]!.init?.headers).toMatchObject({
      "x-kota-operator-action": "confirm-dangerous",
      [SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER]: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(calls[3]!.init?.headers)).not.toContain("a".repeat(64));
  });

  it("does not disclose a reusable credential to a fake endpoint", async () => {
    const { transport, calls } = makeRecordingTransport((path) => {
      if (path === SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH) {
        return jsonResponse(200, { proof: "d".repeat(64) });
      }
      return jsonResponse(500, {});
    });
    const scopes = daemonOpsModule.daemonClient!(transport).scopes!;

    await withInteractiveOperator(() =>
      expect(scopes.applyAuthority!("p1", {
        expectedRevision: 2,
        reason: "A fake project endpoint must not receive machine authority",
        trust: true,
      }, "confirm-dangerous")).resolves.toMatchObject({
        ok: false,
        reason: "operator_action_required",
        message: expect.stringContaining("could not prove machine authority"),
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH);
    expect(JSON.stringify(calls)).not.toContain("a".repeat(64));
  });

  it("rejects authority apply before transport for a non-interactive client", async () => {
    const { transport, calls } = makeRecordingTransport(() => jsonResponse(500, {}));
    const scopes = daemonOpsModule.daemonClient!(transport).scopes!;
    const priorSessionId = process.env.KOTA_SESSION_ID;
    process.env.KOTA_SESSION_ID = "workflow-agent";
    try {
      await expect(scopes.applyAuthority!("p1", {
        expectedRevision: 4,
        reason: "Programmatic mutation must not reach the daemon",
        trust: true,
      }, "confirm-dangerous")).resolves.toMatchObject({
        ok: false,
        reason: "operator_action_required",
        currentRevision: 4,
      });
      expect(calls).toHaveLength(0);
    } finally {
      if (priorSessionId === undefined) delete process.env.KOTA_SESSION_ID;
      else process.env.KOTA_SESSION_ID = priorSessionId;
    }
  });
});
