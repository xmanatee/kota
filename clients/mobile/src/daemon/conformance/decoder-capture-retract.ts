import { asArray, asBool, asObject, asString, fail } from './decoder-common';

// MARK: - Capture

export type CaptureTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type CaptureRecord =
  | { target: "memory"; recordId: string }
  | { target: "knowledge"; recordId: string }
  | { target: "tasks"; recordId: string; path: string }
  | { target: "inbox"; recordId: string; path: string };

function parseCaptureTarget(raw: unknown, field: string): CaptureTarget {
  const value = asString(raw, field);
  if (
    value === "memory" ||
    value === "knowledge" ||
    value === "tasks" ||
    value === "inbox"
  ) {
    return value;
  }
  return fail(`unknown capture target: ${value}`);
}

function parseCaptureRecord(raw: unknown): CaptureRecord {
  const obj = asObject(raw, "captureRecord");
  const target = parseCaptureTarget(obj.target, "captureRecord.target");
  const recordId = asString(obj.recordId, "captureRecord.recordId");
  switch (target) {
    case "memory":
    case "knowledge":
      return { target, recordId };
    case "tasks":
    case "inbox":
      return {
        target,
        recordId,
        path: asString(obj.path, `captureRecord[${target}].path`),
      };
  }
}

export type CaptureResult =
  | { ok: true; record: CaptureRecord }
  | { ok: false; reason: "ambiguous"; suggestions: CaptureTarget[] }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "contributor_failed";
      target: CaptureTarget;
      message: string;
    };

export function parseCaptureResult(raw: unknown): CaptureResult {
  const obj = asObject(raw, "capture");
  const ok = asBool(obj.ok, "capture.ok");
  if (ok) {
    return { ok: true, record: parseCaptureRecord(obj.record) };
  }
  const reason = asString(obj.reason, "capture.reason");
  switch (reason) {
    case "ambiguous": {
      const suggestions = asArray(obj.suggestions, "capture.suggestions").map(
        (entry, index) =>
          parseCaptureTarget(entry, `capture.suggestions[${index}]`),
      );
      return { ok: false, reason, suggestions };
    }
    case "no_contributors":
      return { ok: false, reason };
    case "contributor_failed":
      return {
        ok: false,
        reason,
        target: parseCaptureTarget(obj.target, "capture.target"),
        message: asString(obj.message, "capture.message"),
      };
    default:
      return fail(`unknown capture reason: ${reason}`);
  }
}

// MARK: - Retract

export type RetractTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type RetractRecord =
  | { target: "memory"; recordId: string }
  | { target: "knowledge"; recordId: string }
  | {
      target: "tasks";
      recordId: string;
      previousPath: string;
      path: string;
      toState: "dropped";
    }
  | { target: "inbox"; recordId: string; path: string };

function parseRetractTarget(raw: unknown, field: string): RetractTarget {
  const value = asString(raw, field);
  if (
    value === "memory" ||
    value === "knowledge" ||
    value === "tasks" ||
    value === "inbox"
  ) {
    return value;
  }
  return fail(`unknown retract target: ${value}`);
}

function parseRetractRecord(raw: unknown): RetractRecord {
  const obj = asObject(raw, "retractRecord");
  const target = parseRetractTarget(obj.target, "retractRecord.target");
  const recordId = asString(obj.recordId, "retractRecord.recordId");
  switch (target) {
    case "memory":
    case "knowledge":
      return { target, recordId };
    case "tasks": {
      const toState = asString(obj.toState, "retractRecord[tasks].toState");
      if (toState !== "dropped") {
        return fail(`unknown retract task toState: ${toState}`);
      }
      return {
        target,
        recordId,
        previousPath: asString(
          obj.previousPath,
          "retractRecord[tasks].previousPath",
        ),
        path: asString(obj.path, "retractRecord[tasks].path"),
        toState,
      };
    }
    case "inbox":
      return {
        target,
        recordId,
        path: asString(obj.path, "retractRecord[inbox].path"),
      };
  }
}

export type RetractResult =
  | { ok: true; record: RetractRecord }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "not_found";
      target: RetractTarget;
      identifier: string;
    }
  | {
      ok: false;
      reason: "contributor_failed";
      target: RetractTarget;
      message: string;
    };

export function parseRetractResult(raw: unknown): RetractResult {
  const obj = asObject(raw, "retract");
  const ok = asBool(obj.ok, "retract.ok");
  if (ok) {
    return { ok: true, record: parseRetractRecord(obj.record) };
  }
  const reason = asString(obj.reason, "retract.reason");
  switch (reason) {
    case "no_contributors":
      return { ok: false, reason };
    case "not_found":
      return {
        ok: false,
        reason,
        target: parseRetractTarget(obj.target, "retract.target"),
        identifier: asString(obj.identifier, "retract.identifier"),
      };
    case "contributor_failed":
      return {
        ok: false,
        reason,
        target: parseRetractTarget(obj.target, "retract.target"),
        message: asString(obj.message, "retract.message"),
      };
    default:
      return fail(`unknown retract reason: ${reason}`);
  }
}
