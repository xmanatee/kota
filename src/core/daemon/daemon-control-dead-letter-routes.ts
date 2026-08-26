import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { ModuleSetupJsonValue } from "#core/modules/setup-requirements.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import { jsonResponse, readBody, resolveProjectIdParam } from "./daemon-control-utils.js";
import type { DeadLetterRedriveTarget } from "./dead-letter-queue.js";

type ParsedBody<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const DEAD_LETTER_STATUSES = ["open", "dismissed", "redriven"] as const;
const DEAD_LETTER_TYPES = [
  "event-envelope",
  "batch-envelope",
  "workflow-dispatch",
  "confirmed-action-dispatch",
] as const;

function isDeadLetterStatus(value: string): value is (typeof DEAD_LETTER_STATUSES)[number] {
  return (DEAD_LETTER_STATUSES as readonly string[]).includes(value);
}

function isDeadLetterType(value: string): value is (typeof DEAD_LETTER_TYPES)[number] {
  return (DEAD_LETTER_TYPES as readonly string[]).includes(value);
}

function parseDeadLetterListQuery(url: URL) {
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const workflowName = url.searchParams.get("workflow") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  return {
    ...(status !== null && isDeadLetterStatus(status) ? { status } : {}),
    ...(type !== null && isDeadLetterType(type) ? { type } : {}),
    ...(workflowName !== undefined ? { workflowName } : {}),
    ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
      ? { limit: Math.min(parsedLimit, 200) }
      : {}),
  };
}

function parseJsonObject(
  raw: Buffer,
): ParsedBody<{ [key: string]: ModuleSetupJsonValue }> {
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as ModuleSetupJsonValue;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, message: "Request body must be a JSON object" };
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
}

function parseDeadLetterReason(raw: Buffer): ParsedBody<string> {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const reason = parsed.value.reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, message: "Body must include non-empty string `reason`" };
  }
  return { ok: true, value: reason };
}

function parseDeadLetterRedrive(raw: Buffer): ParsedBody<{
  reason: string;
  target: DeadLetterRedriveTarget;
}> {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const reason = parsed.value.reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, message: "Body must include non-empty string `reason`" };
  }
  const target = parsed.value.target;
  if (target !== undefined && target !== "original" && target !== "simulation") {
    return { ok: false, message: "`target` must be original or simulation" };
  }
  return {
    ok: true,
    value: { reason, target: target === "simulation" ? "simulation" : "original" },
  };
}

export function buildDaemonDeadLetterControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  const h = deps.handle;
  return [
    {
      method: "GET",
      path: "/workflow/dead-letter",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scope = resolveProjectIdParam(h, url);
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        jsonResponse(res, 200, h.listDeadLetters({
          ...parseDeadLetterListQuery(url),
          projectId: scope.projectId,
        }));
      },
    },
    {
      method: "GET",
      path: "/workflow/dead-letter/:id",
      capabilityScope: "read",
      handler: (req, res, params) => {
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        const item = h.getDeadLetter(params.id, scope.projectId);
        if (!item) {
          jsonResponse(res, 404, { error: "Dead-letter item not found" });
          return;
        }
        jsonResponse(res, 200, { item });
      },
    },
    {
      method: "GET",
      path: "/workflow/dead-letter/:id/diagnostics",
      capabilityScope: "read",
      handler: (req, res, params) => {
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        const diagnostics = h.exportDeadLetterDiagnostics(params.id, scope.projectId);
        if (!diagnostics) {
          jsonResponse(res, 404, { error: "Dead-letter item not found" });
          return;
        }
        jsonResponse(res, 200, diagnostics);
      },
    },
    {
      method: "POST",
      path: "/workflow/dead-letter/:id/dismiss",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        const body = parseDeadLetterReason(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { error: body.message });
          return;
        }
        const result = h.dismissDeadLetter(params.id, body.value, scope.projectId);
        if (!result.ok) {
          jsonResponse(res, 404, { error: "Dead-letter item not found" });
          return;
        }
        jsonResponse(res, 200, result);
      },
    },
    {
      method: "POST",
      path: "/workflow/dead-letter/:id/redrive",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const scope = resolveProjectIdParam(h, new URL(req.url ?? "/", "http://127.0.0.1"));
        if (!scope.ok) {
          jsonResponse(res, scope.status, scope.error);
          return;
        }
        const body = parseDeadLetterRedrive(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { error: body.message });
          return;
        }
        const result = h.redriveDeadLetter(
          params.id,
          body.value.reason,
          body.value.target,
          scope.projectId,
        );
        if (!result.ok) {
          const status = result.reason === "not_found" ? 404 : 409;
          jsonResponse(res, status, {
            error: result.reason === "unknown_workflow"
              ? "Redrive workflow is not available"
              : result.reason === "admission_rejected"
                ? "Redrive workflow admission was rejected"
              : "Dead-letter item is not redrivable",
            reason: result.reason,
          });
          return;
        }
        jsonResponse(res, 200, result);
      },
    },
  ];
}
