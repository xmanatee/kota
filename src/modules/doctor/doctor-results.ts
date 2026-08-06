import type { DoctorCheckResult } from "./client.js";

export function pass(label: string, detail?: string): DoctorCheckResult {
  return detail === undefined
    ? { label, status: "pass" }
    : { label, status: "pass", detail };
}

export function warn(label: string, detail?: string): DoctorCheckResult {
  return detail === undefined
    ? { label, status: "warn" }
    : { label, status: "warn", detail };
}

export function fail(label: string, detail?: string): DoctorCheckResult {
  return detail === undefined
    ? { label, status: "fail" }
    : { label, status: "fail", detail };
}
