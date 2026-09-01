import type { CaptureResult, CaptureTarget } from "./client.js";

function renderCaptureSuccess(result: Extract<CaptureResult, { ok: true }>): string {
  switch (result.target) {
    case "memory":
    case "knowledge":
      return `${result.target}  ${result.id}`;
    case "tasks":
    case "inbox":
      return `${result.target}  ${result.id}  ${result.path}`;
  }
}

export function renderCaptureResultPlain(result: CaptureResult): string {
  if (result.ok) return `Captured: ${renderCaptureSuccess(result)}`;
  switch (result.reason) {
    case "ambiguous":
      return `Ambiguous capture. Re-run with --target <one of: ${result.suggestions.join(", ")}>.`;
    case "invalid_slug":
      return `Capture into ${result.target} rejected an invalid title${result.message ? `: ${result.message}` : "."}`;
    case "already_exists":
      return `Capture into ${result.target} already exists${result.message ? `: ${result.message}` : "."}`;
    case "write_failed":
      return `Capture into ${result.target} failed: ${result.message}`;
  }
}

function renderCaptureAmbiguousReplyPlain(
  suggestions: ReadonlyArray<CaptureTarget>,
): string {
  const commands = suggestions.map((target) => `/capture-to-${target}`).join(", ");
  return `Capture target ambiguous. Suggestions: ${suggestions.join(", ")}. Re-run with one of: ${commands}.`;
}

export function renderCaptureReplyPlain(result: CaptureResult): string {
  if (result.ok) {
    const suffix =
      result.target === "tasks" || result.target === "inbox"
        ? ` (${result.path})`
        : "";
    return `Captured to ${result.target}: ${result.id}${suffix}`;
  }
  if (result.reason === "ambiguous") {
    return renderCaptureAmbiguousReplyPlain(result.suggestions);
  }
  return renderCaptureResultPlain(result);
}
