import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import {
  resolvePathIdentities,
} from "#core/util/real-path.js";
import {
  SCOPE_AUTHORITY_OPERATOR_ACTION_HEADER,
  type ScopeAuthorityOperatorActionValue,
} from "./scope-authority-types.js";

export const SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER =
  "x-kota-scope-authority-challenge";
export const SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER =
  "x-kota-scope-authority-proof";
export const SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH =
  "/scope-authority/operator-challenge";

type ScopeAuthorityOperatorTokenRecord = {
  schema: 1;
  token: string;
};

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const CHALLENGE_PATTERN = TOKEN_PATTERN;
const PROOF_PATTERN = TOKEN_PATTERN;
const TOKEN_FILE_NAME = "scope-authority-token.json";
const TOKEN_PATH_ENV = "KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH";
const CHALLENGE_DOMAIN = "kota.scope-authority.challenge.v1";
const REQUEST_DOMAIN = "kota.scope-authority.request.v1";
const CHALLENGE_TTL_MS = 30_000;
const MAX_PENDING_CHALLENGES = 64;
const VERIFIED_OPERATOR_ACTION = Symbol("verified-scope-authority-operator-action");
const VERIFIED_OPERATOR_TOKEN = Symbol("verified-scope-authority-operator-token");
const VERIFIED_OPERATOR_ACTIONS = new WeakSet<ScopeAuthorityOperatorAction>();

export type ScopeAuthorityOperatorRequest = {
  value: ScopeAuthorityOperatorActionValue;
  scopeId: string;
  body: string;
  challenge: string;
};

/** Opaque capability created only after a one-time machine request proof is verified. */
export class ScopeAuthorityOperatorAction {
  readonly source = "interactive-operator-client" as const;

  constructor(
    capability: symbol,
    readonly confirmedDangerousChange: boolean,
  ) {
    if (capability !== VERIFIED_OPERATOR_ACTION) {
      throw new Error("Scope authority operator actions must be verified by the daemon");
    }
    VERIFIED_OPERATOR_ACTIONS.add(this);
  }
}

/** Reject prototype-forged lookalikes at the service boundary. */
export function isVerifiedScopeAuthorityOperatorAction(
  value: ScopeAuthorityOperatorAction | undefined,
): value is ScopeAuthorityOperatorAction {
  return value !== undefined && VERIFIED_OPERATOR_ACTIONS.has(value);
}

/** Daemon-held verifier; the persisted secret is never exposed through it. */
export class ScopeAuthorityOperatorTokenVerifier {
  readonly #expectedToken: string;
  readonly #pendingChallenges = new Map<string, number>();

  constructor(capability: symbol, expectedToken: string) {
    if (capability !== VERIFIED_OPERATOR_TOKEN) {
      throw new Error("Scope authority token verifiers must be created from machine state");
    }
    this.#expectedToken = expectedToken;
  }

  answerChallenge(challenge: string): string | undefined {
    if (!CHALLENGE_PATTERN.test(challenge)) return undefined;
    const now = Date.now();
    for (const [pending, expiresAt] of this.#pendingChallenges) {
      if (expiresAt <= now) this.#pendingChallenges.delete(pending);
    }
    if (this.#pendingChallenges.size >= MAX_PENDING_CHALLENGES) {
      const oldest = this.#pendingChallenges.keys().next();
      if (!oldest.done) this.#pendingChallenges.delete(oldest.value);
    }
    this.#pendingChallenges.set(challenge, now + CHALLENGE_TTL_MS);
    return signChallenge(this.#expectedToken, challenge);
  }

  authorize(
    request: ScopeAuthorityOperatorRequest,
    suppliedProof: string | undefined,
  ): ScopeAuthorityOperatorAction | undefined {
    const expiresAt = this.#pendingChallenges.get(request.challenge);
    this.#pendingChallenges.delete(request.challenge);
    if (
      expiresAt === undefined ||
      expiresAt <= Date.now() ||
      suppliedProof === undefined ||
      !PROOF_PATTERN.test(suppliedProof) ||
      !equalSecret(suppliedProof, signRequest(this.#expectedToken, request))
    ) return undefined;
    return new ScopeAuthorityOperatorAction(
      VERIFIED_OPERATOR_ACTION,
      request.value === "confirm-dangerous",
    );
  }
}

function signChallenge(token: string, challenge: string): string {
  return createHmac("sha256", token)
    .update(JSON.stringify([CHALLENGE_DOMAIN, challenge]))
    .digest("hex");
}

function signRequest(token: string, request: ScopeAuthorityOperatorRequest): string {
  return createHmac("sha256", token)
    .update(JSON.stringify([
      REQUEST_DOMAIN,
      request.value,
      request.scopeId,
      request.body,
      request.challenge,
    ]))
    .digest("hex");
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function scopeAuthorityOperatorTokenPath(
  authorityConfigPath?: string,
): string {
  if (authorityConfigPath !== undefined) {
    return join(dirname(authorityConfigPath), TOKEN_FILE_NAME);
  }
  const configuredPath = process.env[TOKEN_PATH_ENV]?.trim();
  return configuredPath
    ? resolve(configuredPath)
    : join(dirname(getGlobalConfigPath()), TOKEN_FILE_NAME);
}

/** Every credential location protected by agent-facing tool and harness boundaries. */
export function scopeAuthorityOperatorTokenPaths(
  authorityConfigPath?: string,
): string[] {
  const configuredPaths = [...new Set([
    scopeAuthorityOperatorTokenPath(authorityConfigPath),
    scopeAuthorityOperatorTokenPath(),
  ])];
  return [...new Set(
    configuredPaths.flatMap((path) => resolvePathIdentities(path, process.cwd())),
  )];
}

export type ScopeAuthorityOperatorTokenPathContext = {
  baseDirectory: string;
  authorityConfigPath: string | undefined;
};

export function isScopeAuthorityOperatorTokenPath(
  path: string,
  context: ScopeAuthorityOperatorTokenPathContext,
): boolean {
  const requestedPaths = new Set(resolvePathIdentities(path, context.baseDirectory));
  return scopeAuthorityOperatorTokenPaths(context.authorityConfigPath).some(
    (tokenPath) => requestedPaths.has(tokenPath),
  );
}

function readScopeAuthorityOperatorToken(
  authorityConfigPath?: string,
): string | undefined {
  const path = scopeAuthorityOperatorTokenPath(authorityConfigPath);
  const record = readOptionalJsonFile<ScopeAuthorityOperatorTokenRecord>(path);
  if (record === null) return undefined;
  if (record.schema !== 1 || !TOKEN_PATTERN.test(record.token)) {
    throw new Error(`${path}: invalid scope authority operator token record`);
  }
  chmodSync(path, 0o600);
  return record.token;
}

export function createScopeAuthorityOperatorTokenVerifier(
  authorityConfigPath?: string,
): ScopeAuthorityOperatorTokenVerifier {
  const current = readScopeAuthorityOperatorToken(authorityConfigPath);
  const token = current ?? randomBytes(32).toString("hex");
  if (current === undefined) {
    writeJsonFileAtomic(
      scopeAuthorityOperatorTokenPath(authorityConfigPath),
      { schema: 1, token } satisfies ScopeAuthorityOperatorTokenRecord,
      undefined,
      { mode: 0o600 },
    );
  }
  return new ScopeAuthorityOperatorTokenVerifier(VERIFIED_OPERATOR_TOKEN, token);
}

type InteractiveScopeAuthorityOperatorFailure = { ok: false; message: string };

export type InteractiveScopeAuthorityOperatorChallenge =
  | { ok: true; challenge: string }
  | InteractiveScopeAuthorityOperatorFailure;

export type InteractiveScopeAuthorityOperatorHeaders =
  | { ok: true; headers: Record<string, string> }
  | InteractiveScopeAuthorityOperatorFailure;

function interactiveScopeAuthorityOperatorToken():
  | { ok: true; token: string }
  | InteractiveScopeAuthorityOperatorFailure {
  if (process.env.KOTA_SESSION_ID !== undefined || process.stdin.isTTY !== true) {
    return {
      ok: false,
      message: "Applying scope authority requires an interactive operator terminal",
    };
  }
  const token = readScopeAuthorityOperatorToken();
  return token === undefined
    ? { ok: false, message: "Scope authority operator credential is unavailable" }
    : { ok: true, token };
}

export function scopeAuthorityOperatorChallengeForInteractiveClient():
  InteractiveScopeAuthorityOperatorChallenge {
  const credential = interactiveScopeAuthorityOperatorToken();
  if (!credential.ok) return credential;
  return { ok: true, challenge: randomBytes(32).toString("hex") };
}

/**
 * Verify that the selected daemon knows the machine credential, then sign the
 * exact one-time request. The reusable credential never crosses the transport.
 */
export function scopeAuthorityOperatorHeadersForInteractiveClient(
  request: ScopeAuthorityOperatorRequest,
  challengeProof: string | undefined,
): InteractiveScopeAuthorityOperatorHeaders {
  const credential = interactiveScopeAuthorityOperatorToken();
  if (!credential.ok) return credential;
  if (
    !CHALLENGE_PATTERN.test(request.challenge) ||
    challengeProof === undefined ||
    !PROOF_PATTERN.test(challengeProof) ||
    !equalSecret(challengeProof, signChallenge(credential.token, request.challenge))
  ) {
    return {
      ok: false,
      message: "Selected daemon endpoint could not prove machine authority",
    };
  }
  return {
    ok: true,
    headers: {
      [SCOPE_AUTHORITY_OPERATOR_ACTION_HEADER]: request.value,
      [SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER]: request.challenge,
      [SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER]: signRequest(credential.token, request),
    },
  };
}
