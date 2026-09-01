import type { RecallHit } from "#modules/recall/client.js";
import type { UiActionExecutionResult } from "./operator-ui-actions.js";
import {
  booleanParameter,
  type CapabilityActionArgs,
  missingParameter,
  numberParameter,
  stringParameter,
} from "./operator-ui-capability-action-parameters.js";

export async function executeContentCapabilityUiAction(
  args: CapabilityActionArgs,
): Promise<UiActionExecutionResult | null> {
  const { client, operation, parameters } = args;

  if (operation.namespace === "recall" && operation.method === "recall") {
    const query = stringParameter(parameters, "query");
    if (!query) return missingParameter("query");
    const topK = numberParameter(parameters, "topK");
    const result = await client.recall.recall(query, topK === undefined ? undefined : { topK });
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: "Cross-store recall is unavailable." };
    }
    const lines = result.hits.map((hit) =>
      `${hit.source}:${hit.id} · ${(hit.score * 100).toFixed(0)}% · ${recallHitText(hit)}`,
    );
    return { ok: true, message: lines.join("\n") || "No matching context found." };
  }

  if (operation.namespace === "answer" && operation.method === "answer") {
    const query = stringParameter(parameters, "query");
    if (!query) return missingParameter("query");
    const result = await client.answer.answer(query);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: `Answer unavailable: ${result.reason}.` };
    }
    const citations = result.citations.map((citation) => `${citation.source}:${citation.id}`);
    return { ok: true, message: `${result.answer}\n\nCitations: ${citations.join(", ") || "none"}` };
  }

  if (operation.namespace === "answer" && operation.method === "log") {
    const result = await client.answer.log({ limit: 10 });
    const lines = result.entries.map((entry) =>
      `${entry.id} · ${entry.createdAt} · ${entry.query} · ${entry.result.ok ? "answered" : entry.result.reason}`,
    );
    return { ok: true, message: lines.join("\n") || "No answers in history." };
  }

  if (operation.namespace === "answer" && operation.method === "show") {
    const answerId = stringParameter(parameters, "answerId");
    if (!answerId) return missingParameter("answerId");
    const result = await client.answer.show(answerId);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: `Answer ${answerId} was not found.` };
    }
    const answer = result.record.result;
    return {
      ok: true,
      message: answer.ok
        ? `${result.record.query}\n\n${answer.answer}\n\n${answer.citations.map((citation) => `${citation.source}:${citation.id}`).join(", ")}`
        : `${result.record.query}\n\nAnswer failed: ${answer.reason}.`,
    };
  }

  if (operation.namespace === "capture" && operation.method === "capture") {
    const text = stringParameter(parameters, "text");
    if (!text) return missingParameter("text");
    const rawTarget = stringParameter(parameters, "target");
    const target = rawTarget === "auto" || rawTarget === undefined ? undefined : captureTarget(rawTarget);
    if (rawTarget !== undefined && rawTarget !== "auto" && target === undefined) {
      return { ok: false, reason: "invalid-input", message: `Unknown capture target: ${rawTarget}.` };
    }
    const result = await client.capture.capture(text, target ? { target } : undefined);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: result.reason === "ambiguous"
          ? `Choose a destination: ${result.suggestions.join(", ")}.`
          : result.reason === "write_failed"
            ? result.message
            : `Capture rejected: ${result.reason}.`,
      };
    }
    return { ok: true, message: `Captured ${result.target}:${result.id}.` };
  }

  if (operation.namespace === "retract" && operation.method === "retract") {
    const target = stringParameter(parameters, "target");
    const identifier = stringParameter(parameters, "identifier");
    if (!target) return missingParameter("target");
    if (!identifier) return missingParameter("identifier");
    const request = retractRequest(target, identifier);
    if (!request) {
      return { ok: false, reason: "invalid-input", message: `Unknown retract target: ${target}.` };
    }
    const result = await client.retract.retract(request);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: result.reason === "retract_failed"
          ? result.message
          : result.reason === "not_found"
            ? `${result.target}:${result.identifier} was not found.`
            : `Retract rejected: ${result.reason}.`,
      };
    }
    return { ok: true, message: `Retracted ${result.target}:${result.identifier}.` };
  }

  if (operation.namespace === "knowledge" && operation.method === "search") {
    const query = stringParameter(parameters, "query");
    if (!query) return missingParameter("query");
    const semantic = booleanParameter(parameters, "semantic") ?? true;
    const limit = numberParameter(parameters, "limit") ?? 10;
    const result = await client.knowledge.search(query, { semantic, limit });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: "Semantic knowledge search requires an embedding-backed knowledge provider. Turn off semantic ranking to use keyword search.",
      };
    }
    const lines = result.entries.map((entry) =>
      `${entry.id} · ${entry.title} · ${entry.type ?? "note"} · ${entry.status ?? "stored"}`,
    );
    return { ok: true, message: lines.join("\n") || "No matching knowledge entries." };
  }

  if (operation.namespace === "history" && operation.method === "show") {
    const historyId = stringParameter(parameters, "historyId");
    if (!historyId) return missingParameter("historyId");
    const result = await client.history.show(historyId, { view: "window", limit: 20, contentLimit: 4_000 });
    if (!result.found) {
      return { ok: false, reason: "not_found", message: `Conversation ${historyId} was not found.` };
    }
    if (result.detail.view !== "window") {
      return { ok: true, message: `${result.detail.record.id} · ${result.detail.record.title ?? "Conversation"}` };
    }
    const messages = result.detail.messages.map((message) =>
      `${message.role}: ${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`,
    );
    return { ok: true, message: messages.join("\n\n") || "Conversation has no messages." };
  }

  if (operation.namespace === "config" && operation.method === "validate") {
    const result = await client.config.validate();
    return { ok: true, message: `${result.sources.length} source(s); ${result.warnings.length} warning(s).${result.warnings.length > 0 ? `\n${result.warnings.join("\n")}` : ""}` };
  }
  if (operation.namespace === "config" && operation.method === "get") {
    const key = stringParameter(parameters, "key");
    if (!key) return missingParameter("key");
    const result = await client.config.get(key);
    if (!result.found) {
      return { ok: false, reason: result.reason, message: `Configuration key ${key} was not found.` };
    }
    const value = typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
    return { ok: true, message: `${key} = ${value ?? "undefined"}` };
  }
  if (operation.namespace === "config" && operation.method === "set") {
    const key = stringParameter(parameters, "key");
    const value = stringParameter(parameters, "value");
    if (!key) return missingParameter("key");
    if (value === undefined) return missingParameter("value");
    const result = await client.config.set(key, value);
    return { ok: true, message: result.unknownKey ? `Updated ${key}; ${result.topKey} is not a registered top-level key.` : `Updated ${key}.` };
  }
  if (operation.namespace === "audit" && operation.method === "list") {
    const result = await client.audit.list({ limit: 20 });
    const lines = result.entries.map((entry) =>
      `${entry.ts} · ${entry.tool} · ${entry.risk}/${entry.policy} · ${entry.reason}`,
    );
    return { ok: true, message: lines.join("\n") || "No guardrail audit entries." };
  }

  return null;
}

function captureTarget(value: string): "memory" | "knowledge" | "tasks" | "inbox" | undefined {
  return value === "memory" || value === "knowledge" || value === "tasks" || value === "inbox"
    ? value
    : undefined;
}

function retractRequest(target: string, identifier: string) {
  const resolved = captureTarget(target);
  return resolved ? { target: resolved, identifier } : null;
}

function recallHitText(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge": return `${hit.title} · ${hit.preview}`;
    case "memory":
    case "answer": return hit.preview;
    case "history":
    case "tasks": return hit.title;
  }
}
