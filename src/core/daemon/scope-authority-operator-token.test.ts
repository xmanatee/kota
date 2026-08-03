import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScopeAuthorityOperatorTokenVerifier,
  isScopeAuthorityOperatorTokenPath,
  isVerifiedScopeAuthorityOperatorAction,
  SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER,
  ScopeAuthorityOperatorAction,
  scopeAuthorityOperatorChallengeForInteractiveClient,
  scopeAuthorityOperatorHeadersForInteractiveClient,
  scopeAuthorityOperatorTokenPath,
} from "./scope-authority-operator-token.js";

const roots: string[] = [];

function withInteractiveTokenPath<T>(tokenPath: string, operation: () => T): T {
  const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
  const priorSessionId = process.env.KOTA_SESSION_ID;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH = tokenPath;
  delete process.env.KOTA_SESSION_ID;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    return operation();
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
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scope authority operator token", () => {
  it("recognizes the configured arbitrary token filename and its real-path aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-authority-token-path-"));
    roots.push(root);
    const operatorDir = join(root, "operator");
    const projectDir = join(root, "project");
    const tokenPath = join(operatorDir, "machine-proof.dat");
    mkdirSync(operatorDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(tokenPath, JSON.stringify({ schema: 1, token: "a".repeat(64) }));

    withInteractiveTokenPath(tokenPath, () => {
      const context = {
        baseDirectory: projectDir,
        authorityConfigPath: join(operatorDir, "config.json"),
      };
      expect(isScopeAuthorityOperatorTokenPath(tokenPath, context)).toBe(true);
      expect(
        isScopeAuthorityOperatorTokenPath("scope-authority-token.json", context),
      ).toBe(false);
      try {
        symlinkSync(tokenPath, join(projectDir, "notes.json"));
      } catch (error: unknown) {
        // Symlink creation can be unavailable on constrained Windows hosts.
        if (process.platform === "win32") return;
        throw error;
      }
      expect(isScopeAuthorityOperatorTokenPath("notes.json", context)).toBe(true);
    });
  });

  it("rejects an object with a forged operator-action prototype", () => {
    const forged = Object.assign(
      Object.create(ScopeAuthorityOperatorAction.prototype) as ScopeAuthorityOperatorAction,
      { confirmedDangerousChange: true },
    );

    expect(forged).toBeInstanceOf(ScopeAuthorityOperatorAction);
    expect(isVerifiedScopeAuthorityOperatorAction(forged)).toBe(false);
  });

  it("creates one stable machine-owned credential with owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-authority-token-"));
    roots.push(root);
    const configPath = join(root, "config.json");

    const first = createScopeAuthorityOperatorTokenVerifier(configPath);
    const tokenPath = scopeAuthorityOperatorTokenPath(configPath);
    const firstRecord = JSON.parse(readFileSync(tokenPath, "utf8"));
    const second = createScopeAuthorityOperatorTokenVerifier(configPath);
    const secondRecord = JSON.parse(readFileSync(tokenPath, "utf8"));

    expect(firstRecord.token).toMatch(/^[a-f0-9]{64}$/);
    expect(secondRecord.token).toBe(firstRecord.token);
    expect(first).not.toBe(second);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(tokenPath, "utf8")).not.toContain("config.json");
  });

  it("fails closed for a malformed persisted credential", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-authority-token-invalid-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    writeFileSync(
      scopeAuthorityOperatorTokenPath(configPath),
      JSON.stringify({ schema: 1, token: "too-short" }),
      { mode: 0o600 },
    );

    expect(() => createScopeAuthorityOperatorTokenVerifier(configPath)).toThrow(
      /invalid scope authority operator token record/,
    );
  });

  it("mints a one-time operator action only for an endpoint-authenticated exact request", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-authority-verifier-"));
    roots.push(root);
    const configPath = join(root, "config.json");
    const verifier = createScopeAuthorityOperatorTokenVerifier(configPath);
    const token = JSON.parse(
      readFileSync(scopeAuthorityOperatorTokenPath(configPath), "utf8"),
    ).token as string;

    const challenge = "b".repeat(64);
    const request = {
      value: "apply" as const,
      scopeId: "scope-a",
      body: JSON.stringify({ expectedRevision: 1, reason: "Operator test", trust: false }),
      challenge,
    };
    const challengeProof = verifier.answerChallenge(challenge);
    const signed = withInteractiveTokenPath(
      scopeAuthorityOperatorTokenPath(configPath),
      () => scopeAuthorityOperatorHeadersForInteractiveClient(request, challengeProof),
    );

    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error(signed.message);
    expect(JSON.stringify(signed.headers)).not.toContain(token);
    expect(verifier.authorize(
      request,
      signed.headers[SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER],
    )).toMatchObject({
      source: "interactive-operator-client",
      confirmedDangerousChange: false,
    });
    expect(verifier.authorize(
      request,
      signed.headers[SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER],
    )).toBeUndefined();
  });

  it("refuses to sign for a project-selected endpoint with the wrong machine credential", () => {
    const operatorRoot = mkdtempSync(join(tmpdir(), "kota-authority-operator-"));
    const foreignRoot = mkdtempSync(join(tmpdir(), "kota-authority-foreign-"));
    roots.push(operatorRoot, foreignRoot);
    const operatorConfig = join(operatorRoot, "config.json");
    const foreignVerifier = createScopeAuthorityOperatorTokenVerifier(
      join(foreignRoot, "config.json"),
    );
    createScopeAuthorityOperatorTokenVerifier(operatorConfig);
    const challenge = "c".repeat(64);
    const result = withInteractiveTokenPath(
      scopeAuthorityOperatorTokenPath(operatorConfig),
      () => scopeAuthorityOperatorHeadersForInteractiveClient(
        {
          value: "confirm-dangerous",
          scopeId: "scope-a",
          body: "{}",
          challenge,
        },
        foreignVerifier.answerChallenge(challenge),
      ),
    );

    expect(result).toEqual({
      ok: false,
      message: "Selected daemon endpoint could not prove machine authority",
    });
  });

  it("does not expose authority headers to a workflow or non-interactive client", () => {
    const priorSessionId = process.env.KOTA_SESSION_ID;
    process.env.KOTA_SESSION_ID = "agent-session";
    try {
      expect(scopeAuthorityOperatorChallengeForInteractiveClient()).toMatchObject({
        ok: false,
        message: expect.stringContaining("interactive operator terminal"),
      });
    } finally {
      if (priorSessionId === undefined) delete process.env.KOTA_SESSION_ID;
      else process.env.KOTA_SESSION_ID = priorSessionId;
    }
  });
});
