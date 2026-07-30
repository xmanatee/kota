import {
  isSensitiveToolInputKey,
  redactApprovalCredentialText,
} from "#core/tools/approval-redaction.js";
import { invalidParams } from "./protocol-errors.js";
import { isJsonObject, type JsonObject, type JsonValue } from "./protocol-json-rpc.js";
import { rejectUnknownFields } from "./protocol-mcp.js";

export type AcpPermissionToolContext = {
  sessionId: string;
  approvalId: string;
  toolUseId: string;
  toolName: string;
  input: JsonObject;
  risk: string;
  reason: string;
  timeoutMs: number;
  context?: string;
  reviewDigest?: string;
};

export type AcpPermissionDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; message: string }
  | { outcome: "cancelled"; message: string };

export function permissionRequestParams(request: AcpPermissionToolContext): JsonObject {
  const reviewText = [
    `${request.risk}: ${request.reason}`,
    ...(request.context !== undefined
      ? [`Conversation context:\n${redactApprovalCredentialText(request.context)}`]
      : []),
    ...(request.reviewDigest !== undefined
      ? [`Review digest: ${request.reviewDigest}`]
      : []),
  ].join("\n\n");
  return {
    sessionId: request.sessionId,
    toolCall: {
      toolCallId: request.toolUseId,
      title: `Allow ${request.toolName}`,
      kind: toolKind(request.toolName),
      status: "pending",
      content: [
        {
          type: "content",
          content: { type: "text", text: reviewText },
        },
      ],
      rawInput: redactPermissionInput(request.input),
    },
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ],
  };
}

export function decodePermissionResponse(result: JsonValue | undefined): AcpPermissionDecision {
  if (!isJsonObject(result)) {
    throw invalidParams("session/request_permission response params must be an object");
  }
  rejectUnknownFields(result, new Set(["outcome"]), "session/request_permission response");
  const outcome = result.outcome;
  if (!isJsonObject(outcome)) {
    throw invalidParams("session/request_permission response outcome must be an object");
  }
  if (outcome.outcome === "cancelled") {
    rejectUnknownFields(outcome, new Set(["outcome"]), "session/request_permission response outcome");
    return { outcome: "cancelled", message: "ACP client cancelled the permission request" };
  }
  if (outcome.outcome === "selected") {
    rejectUnknownFields(
      outcome,
      new Set(["outcome", "optionId"]),
      "session/request_permission response outcome",
    );
    if (outcome.optionId === "allow-once") return { outcome: "allow" };
    if (outcome.optionId === "reject-once") {
      return { outcome: "deny", message: "ACP client rejected the tool call" };
    }
    throw invalidParams("session/request_permission selected outcome has an unsupported optionId");
  }
  throw invalidParams('session/request_permission outcome must be "selected" or "cancelled"');
}

function toolKind(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (/(?:bash|shell|exec|process|terminal|command)/.test(normalized)) return "execute";
  if (/(?:delete|remove|unlink)/.test(normalized)) return "delete";
  if (/(?:move|rename)/.test(normalized)) return "move";
  if (/(?:edit|write|patch|replace|create|save)/.test(normalized)) return "edit";
  if (/(?:search|grep|glob|find|list)/.test(normalized)) return "search";
  if (/(?:fetch|http|web)/.test(normalized)) return "fetch";
  if (/(?:read|cat|open)/.test(normalized)) return "read";
  return "other";
}

function redactPermissionInput(input: JsonObject): JsonObject {
  return redactPermissionValue(input) as JsonObject;
}

function redactPermissionValue(value: JsonValue | undefined, key = ""): JsonValue {
  if (isSensitiveToolInputKey(key)) return "[REDACTED]";
  if (typeof value === "string") return redactApprovalCredentialText(value);
  if (Array.isArray(value)) return value.map((entry) => redactPermissionValue(entry));
  if (!isJsonObject(value)) return value ?? null;
  const out: JsonObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    Object.defineProperty(out, childKey, {
      value: redactPermissionValue(childValue, childKey),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}
