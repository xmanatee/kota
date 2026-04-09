import { describe, expect, it } from "vitest";
import { formatStatusOutput, type StatusSnapshot } from "./status-cli.js";

function makeSnap(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    sessions: 0,
    pendingApprovals: 0,
    ...overrides,
  };
}

describe("formatStatusOutput", () => {
  it("shows daemon as not running when offline", () => {
    const out = formatStatusOutput(makeSnap());
    expect(out).toContain("not running");
    expect(out).toContain("offline mode");
  });

  it("shows daemon as running with pid and uptime", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      daemonUptimeMs: 2 * 60 * 60 * 1000 + 14 * 60 * 1000,
    }));
    expect(out).toContain("running");
    expect(out).toContain("pid 12345");
    expect(out).toContain("2h 14m");
  });

  it("shows active and queued run counts", () => {
    const out = formatStatusOutput(makeSnap({ activeRuns: 2, queuedRuns: 3 }));
    expect(out).toContain("2 active, 3 queued");
  });

  it("shows session count", () => {
    const out = formatStatusOutput(makeSnap({ sessions: 1 }));
    expect(out).toContain("1 interactive");
  });

  it("marks pending approvals with attention note", () => {
    const out = formatStatusOutput(makeSnap({ pendingApprovals: 1 }));
    expect(out).toContain("1 pending");
    expect(out).toContain("requires attention");
  });

  it("shows no attention note when approvals are zero", () => {
    const out = formatStatusOutput(makeSnap({ pendingApprovals: 0 }));
    expect(out).toContain("0 pending");
    expect(out).not.toContain("requires attention");
  });

  it("shows budget line when both spend and budget are present", () => {
    const out = formatStatusOutput(makeSnap({ dailySpendUsd: 0.42, dailyBudgetUsd: 5.0 }));
    expect(out).toContain("$0.42 of $5.00 today");
  });

  it("shows spend-only line when budget is not configured", () => {
    const out = formatStatusOutput(makeSnap({ dailySpendUsd: 1.5 }));
    expect(out).toContain("$1.50 today");
    expect(out).not.toContain("of $");
  });

  it("omits budget line when spend is zero and no budget configured", () => {
    const out = formatStatusOutput(makeSnap({ dailySpendUsd: undefined }));
    expect(out).not.toContain("Budget:");
  });

  it("formats uptime under one hour as minutes only", () => {
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 1,
      daemonUptimeMs: 45 * 60 * 1000,
    }));
    expect(out).toContain("45m");
    expect(out).not.toContain("0h");
  });
});
