import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DAEMON_STOP_ATTEMPTS_RELATIVE_PATH,
  recordDaemonStopAttempt,
} from "#modules/daemon-ops/daemon-ops-operations.js";
import {
  collectRuntimeHealthAuditForScope,
  makeRuntimeHealthAuditScopeRoot,
  RUNTIME_HEALTH_AUDIT_NOW,
  reviewAndApplyRuntimeHealthAudit,
  runtimeHealthReadyTaskFiles,
  writeRuntimeHealthModuleLog,
} from "./runtime-health-audit-test-context.js";

describe("runtime health audit operator evidence", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = makeRuntimeHealthAuditScopeRoot();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("reads status-derived operator runtime warnings from daemon control evidence", () => {
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "daemon-control.json"),
      JSON.stringify(
        {
          port: 8765,
          pid: Number.MAX_SAFE_INTEGER,
          startedAt: "2026-06-19T10:00:00.000Z",
          token: "test-token",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot: scopeRoot,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW },
    });

    expect(audit.inspected.operatorRuntimeWarnings).toBeGreaterThanOrEqual(1);
    expect(audit.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: "operator-inbox:runtime:daemon-control-stale",
          category: "operator-action",
          actionability: "owner-action",
          evidenceRefs: [
            expect.objectContaining({
              kind: "artifact",
              ref: join(".kota", "daemon-control.json"),
            }),
          ],
        }),
      ]),
    );
  });

  it("reads daemon stop timeout evidence recorded by daemon-ops", () => {
    recordDaemonStopAttempt({
      scopeRoot,
      attemptedAt: "2026-06-19T11:00:00.000Z",
      timeoutSec: 3,
      result: { ok: false, reason: "timeout", pid: 12345 },
    });

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot: scopeRoot,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW },
    });

    expect(audit.inspected.daemonStopAttempts).toBe(1);
    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "daemon:shutdown-timeout",
        category: "local-code",
        actionability: "local-code",
        severity: "warning",
        evidenceRefs: [
          expect.objectContaining({
            kind: "artifact",
            ref: `${DAEMON_STOP_ATTEMPTS_RELATIVE_PATH}#L1`,
          }),
        ],
      }),
    ]);

    const actions = reviewAndApplyRuntimeHealthAudit(scopeRoot, audit);
    expect(actions.createdTaskIds).toEqual([]);
    expect(actions.issueTransitions).toEqual([]);

    recordDaemonStopAttempt({
      scopeRoot,
      attemptedAt: "2026-06-19T11:30:00.000Z",
      timeoutSec: 3,
      result: { ok: false, reason: "timeout", pid: 12345 },
    });
    const repeatedAudit = collectRuntimeHealthAuditForScope({
      workspaceRoot: scopeRoot,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW },
    });
    const repeatedActions = reviewAndApplyRuntimeHealthAudit(scopeRoot, repeatedAudit);
    expect(repeatedActions.createdTaskIds).toEqual([]);
    expect(repeatedActions.issueTransitions).toEqual([
      expect.objectContaining({ kind: "opened", requiresDecision: true }),
    ]);
  });

  it("keeps noisy external provider failures out of local repair tasks", () => {
    writeRuntimeHealthModuleLog(scopeRoot, "email", [
      JSON.stringify({ message: "SMTP provider network timeout" }),
      JSON.stringify({ message: "SMTP provider ECONNRESET while sending" }),
      JSON.stringify({ message: "SMTP provider network timeout" }),
    ]);

    const audit = collectRuntimeHealthAuditForScope({
      workspaceRoot: scopeRoot,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "module:email:external-provider-failure",
        category: "external-service/auth",
        actionability: "external-service",
      }),
    ]);

    const actions = reviewAndApplyRuntimeHealthAudit(scopeRoot, audit);
    expect(actions.createdTaskIds).toEqual([]);
    expect(runtimeHealthReadyTaskFiles(scopeRoot)).toEqual([]);
  });
});
