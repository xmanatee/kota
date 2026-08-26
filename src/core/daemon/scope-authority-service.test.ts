import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScopeAuthorityOperatorTokenVerifier,
  SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER,
  ScopeAuthorityOperatorAction,
  scopeAuthorityOperatorHeadersForInteractiveClient,
  scopeAuthorityOperatorTokenPath,
} from "./scope-authority-operator-token.js";
import { ScopeAuthorityService } from "./scope-authority-service.js";
import type {
  ScopeAuthorityPersistence,
  ScopeAuthorityStoredState,
} from "./scope-authority-types.js";
import { ScopeRegistry } from "./scope-registry.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ScopeAuthorityService", () => {
  it("applies trust and policy in one revisioned commit with provenance", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();
    const result = await fixture.service.apply(scopeId, {
      expectedRevision: 0,
      reason: "Operator approved supervised local work.",
      trust: true,
      policy: {
        scopeId,
        reason: "Start external scopes under supervision.",
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
        writes: { mode: "scope-directory" },
        externalEffects: { networkWrite: "deny", networkDestructive: "deny" },
      },
    }, operatorAction());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("applied");
    expect(result.authority.revision).toBe(1);
    expect(result.authority.trust).toEqual({ trusted: true, source: "machine-config" });
    expect(result.authority.resolvedPolicy.autonomy.source.scopeId).toBe(scopeId);
    expect(result.authority.audit[0]).toMatchObject({
      revision: 1,
      reason: "Operator approved supervised local work.",
      trust: { before: false, after: true },
      policy: { operation: "set" },
    });
    expect(fixture.persistence.commitCount).toBe(1);
  });

  it("serializes concurrent mutations and rejects the stale revision", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();
    const mutation = {
      expectedRevision: 0,
      reason: "Trust this registered fixture.",
      trust: true,
    } as const;

    const [first, second] = await Promise.all([
      fixture.service.apply(scopeId, mutation, operatorAction()),
      fixture.service.apply(scopeId, mutation, operatorAction()),
    ]);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "revision_conflict", currentRevision: 1 });
    expect(fixture.persistence.commitCount).toBe(1);
  });

  it("returns policy and revision from one authority snapshot", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();
    const initial = fixture.service.getSnapshot(scopeId);

    const applied = await fixture.service.apply(scopeId, {
      expectedRevision: initial.revision,
      reason: "Restrict writes for the next authority snapshot.",
      policy: {
        scopeId,
        reason: "The fixture becomes read-only.",
        writes: { mode: "none" },
      },
    }, operatorAction());

    expect(applied.ok).toBe(true);
    expect(initial).toMatchObject({ revision: 0, policy: { writes: { mode: "unrestricted" } } });
    expect(fixture.service.getSnapshot(scopeId)).toMatchObject({
      revision: 1,
      policy: { writes: { mode: "none" } },
    });
  });

  it("publishes committed restrictive revisions but not equal or purely permissive mutations", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();
    const changes: Array<{
      previousRevision: number;
      currentRevision: number;
      areas: readonly string[];
    }> = [];
    const unsubscribe = fixture.service.subscribeRestrictiveChanges(scopeId, (change) => {
      changes.push({
        previousRevision: change.previous.revision,
        currentRevision: change.current.revision,
        areas: change.restrictiveAreas,
      });
    });

    const restricted = await fixture.service.apply(scopeId, {
      expectedRevision: 0,
      reason: "Disable writes and outbound network access.",
      policy: {
        scopeId,
        reason: "Exercise live restrictive notification.",
        writes: { mode: "none" },
        externalEffects: { networkRead: "deny" },
      },
    }, operatorAction());
    expect(restricted.ok).toBe(true);
    expect(changes).toEqual([{
      previousRevision: 0,
      currentRevision: 1,
      areas: ["writes", "externalEffects"],
    }]);

    const equal = await fixture.service.apply(scopeId, {
      expectedRevision: 1,
      reason: "Submit an equal policy.",
      policy: {
        scopeId,
        reason: "Exercise live restrictive notification.",
        writes: { mode: "none" },
        externalEffects: { networkRead: "deny" },
      },
    }, operatorAction());
    expect(equal).toMatchObject({ ok: true, status: "unchanged" });

    const permissive = await fixture.service.apply(scopeId, {
      expectedRevision: 1,
      reason: "Restore the migration policy.",
      policy: null,
    }, operatorAction(true));
    expect(permissive).toMatchObject({ ok: true, status: "applied" });
    expect(fixture.service.getSnapshot(scopeId).revision).toBe(2);
    expect(changes).toHaveLength(1);

    unsubscribe();
    await fixture.service.apply(scopeId, {
      expectedRevision: 2,
      reason: "Restrict again after listener cleanup.",
      policy: {
        scopeId,
        reason: "No listener remains.",
        writes: { mode: "none" },
      },
    }, operatorAction());
    expect(changes).toHaveLength(1);
  });

  it("does not publish either half when persistence fails", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();
    fixture.persistence.failCommit = true;

    const result = await fixture.service.apply(scopeId, {
      expectedRevision: 0,
      reason: "Attempt one atomic update.",
      trust: true,
      policy: {
        scopeId,
        reason: "No writes for this fixture.",
        writes: { mode: "none" },
      },
    }, operatorAction());

    expect(result).toMatchObject({ ok: false, reason: "persistence_failed" });
    expect(fixture.persistence.read()).toMatchObject({
      trustedScopes: [],
      scopePolicies: [],
      metadata: { revision: 0, audit: [] },
    });
  });

  it("returns a typed parent conflict for forbidden child widening", () => {
    const fixture = createFixture({
      trustedScopes: [],
      scopePolicies: [{
        scopeId: "global",
        reason: "Machine policy caps all children at supervised mode.",
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
      }],
      metadata: { schema: 1, revision: 0, audit: [] },
    });
    const scopeId = fixture.registry.getDefaultScopeId();

    const result = fixture.service.validate(scopeId, {
      expectedRevision: 0,
      reason: "Attempt autonomous execution.",
      policy: {
        scopeId,
        reason: "Child asks to exceed the machine cap.",
        autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "parent_policy_conflict",
      conflict: { parentScopeId: "global", area: "autonomy" },
    });
  });

  it("rejects direct programmatic authority writes without an operator action", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();

    const result = await fixture.service.apply(scopeId, {
      expectedRevision: 0,
      reason: "A workflow attempts to trust itself.",
      trust: true,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "operator_action_required",
      currentRevision: 0,
    });
    expect(fixture.persistence.commitCount).toBe(0);
  });

  it("rejects a prototype-forged operator action", async () => {
    const fixture = createFixture();
    const scopeId = fixture.registry.getDefaultScopeId();
    const forged = Object.assign(
      Object.create(ScopeAuthorityOperatorAction.prototype) as ScopeAuthorityOperatorAction,
      { confirmedDangerousChange: true },
    );

    const result = await fixture.service.apply(scopeId, {
      expectedRevision: 0,
      reason: "A programmatic caller forges the exported prototype.",
      trust: true,
    }, forged);

    expect(result).toMatchObject({
      ok: false,
      reason: "operator_action_required",
      currentRevision: 0,
    });
    expect(fixture.persistence.commitCount).toBe(0);
  });

  it("notifies the live daemon only after persisted trust is revoked", async () => {
    const revoked: string[] = [];
    const fixture = createFixture(undefined, (scopeId) => revoked.push(scopeId));
    const scopeId = fixture.registry.getDefaultScopeId();

    const trusted = await fixture.service.apply(scopeId, {
      expectedRevision: 0,
      reason: "Trust the fixture before exercising live revocation.",
      trust: true,
    }, operatorAction());
    expect(trusted.ok).toBe(true);
    expect(revoked).toEqual([]);

    const untrusted = await fixture.service.apply(scopeId, {
      expectedRevision: 1,
      reason: "Revoke project-controlled runtime authority now.",
      trust: false,
    }, operatorAction());

    expect(untrusted).toMatchObject({
      ok: true,
      status: "applied",
      authority: { trust: { trusted: false, source: "default-untrusted" } },
    });
    expect(revoked).toEqual([scopeId]);
    expect(fixture.persistence.read().metadata.revision).toBe(2);
  });
});

function operatorAction(confirmedDangerousChange = true): ScopeAuthorityOperatorAction {
  const root = mkdtempSync(join(tmpdir(), "kota-scope-authority-token-"));
  tempRoots.push(root);
  const configPath = join(root, "config.json");
  const verifier = createScopeAuthorityOperatorTokenVerifier(configPath);
  const request = {
    value: confirmedDangerousChange ? "confirm-dangerous" as const : "apply" as const,
    scopeId: "fixture-scope",
    body: "{}",
    challenge: "e".repeat(64),
  };
  const priorTokenPath = process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH;
  const priorSessionId = process.env.KOTA_SESSION_ID;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH =
    scopeAuthorityOperatorTokenPath(configPath);
  delete process.env.KOTA_SESSION_ID;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    const signed = scopeAuthorityOperatorHeadersForInteractiveClient(
      request,
      verifier.answerChallenge(request.challenge),
    );
    if (!signed.ok) throw new Error(signed.message);
    const action = verifier.authorize(
      request,
      signed.headers[SCOPE_AUTHORITY_OPERATOR_PROOF_HEADER],
    );
    if (action === undefined) throw new Error("fixture operator action was not authorized");
    return action;
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

class FakeAuthorityPersistence implements ScopeAuthorityPersistence {
  commitCount = 0;
  failCommit = false;

  constructor(private state: ScopeAuthorityStoredState) {}

  read(): ScopeAuthorityStoredState {
    return structuredClone(this.state);
  }

  async commit(
    expectedRevision: number,
    next: ScopeAuthorityStoredState,
  ): Promise<ScopeAuthorityStoredState> {
    if (this.state.metadata.revision !== expectedRevision) {
      throw new Error("stale fixture revision");
    }
    if (this.failCommit) throw new Error("injected durable-write failure");
    this.commitCount += 1;
    this.state = structuredClone(next);
    return this.read();
  }
}

function createFixture(
  initial?: ScopeAuthorityStoredState,
  onTrustRevoked: (scopeId: string) => void = () => {},
) {
  const root = mkdtempSync(join(tmpdir(), "kota-scope-authority-"));
  tempRoots.push(root);
  const scopeRoot = join(root, "external-project");
  const stateDir = join(root, "daemon-state");
  mkdirSync(scopeRoot, { recursive: true });
  const registry = new ScopeRegistry({ stateDir, scopes: [{ scopeRoot }] });
  const persistence = new FakeAuthorityPersistence(initial ?? {
    trustedScopes: [],
    scopePolicies: [],
    metadata: { schema: 1, revision: 0, audit: [] },
  });
  const service = new ScopeAuthorityService(
    persistence,
    registry,
    () => new Date("2026-08-01T12:00:00.000Z"),
    () => "authority-audit-1",
    onTrustRevoked,
  );
  return { registry, persistence, service };
}
