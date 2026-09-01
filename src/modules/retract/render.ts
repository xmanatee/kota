import type { RetractResult } from "./client.js";

export type RetractSlashCommand =
  | "/retract-memory"
  | "/retract-knowledge"
  | "/retract-tasks"
  | "/retract-inbox";

export function retractUsageBody(command: RetractSlashCommand): string {
  return `Usage: ${command} <${command === "/retract-knowledge" ? "slug" : command === "/retract-inbox" ? "path" : "id"}>`;
}

export function renderRetractResultPlain(result: RetractResult): string {
  if (result.ok) {
    switch (result.target) {
      case "memory":
      case "knowledge":
        return `Retracted: ${result.target}  ${result.identifier}`;
      case "tasks":
        return `Retracted: tasks  ${result.id}  ${result.previousPath} -> ${result.path} (${result.toState})`;
      case "inbox":
        return `Retracted: inbox  ${result.recordId}  ${result.path}`;
    }
  }
  switch (result.reason) {
    case "not_found":
      return `Retract ${result.target}: no record with identifier "${result.identifier}".`;
    case "invalid_id":
      return `Retract ${result.target}: invalid identifier "${result.identifier}".`;
    case "already_in_state":
      return `Retract ${result.target}: record "${result.identifier}" is already ${result.state}.`;
    case "retract_failed":
      return `Retract from ${result.target} failed: ${result.message}`;
  }
}
