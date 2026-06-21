import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type NormalizedScopeSelector,
  type ScopeSelectorArgument,
  resolveScopeSelector,
  resolveScopeSelectorFromUrl,
} from "./scope-selector.js";
import { jsonResponse } from "./session-pool.js";

export function readScopeSelectorQueryOrErrorResponse(
  req: IncomingMessage,
  res: ServerResponse,
  base = "http://localhost",
): NormalizedScopeSelector | null {
  const resolved = resolveScopeSelectorFromUrl(new URL(req.url ?? "", base));
  if (resolved.ok) return resolved.selector;
  jsonResponse(res, resolved.status, resolved.body);
  return null;
}

export function selectedScopeSelectorIdOrErrorResponse(
  res: ServerResponse,
  selector?: ScopeSelectorArgument,
): string | null | undefined {
  const resolved = resolveScopeSelector(selector);
  if (resolved.ok) return resolved.selectedId;
  jsonResponse(res, resolved.status, resolved.body);
  return null;
}

export function selectedScopeSelectorIdFromUrlOrErrorResponse(
  res: ServerResponse,
  url: URL,
): string | null | undefined {
  const resolved = resolveScopeSelectorFromUrl(url);
  if (resolved.ok) return resolved.selectedId;
  jsonResponse(res, resolved.status, resolved.body);
  return null;
}

export function readSelectedScopeSelectorIdQueryOrErrorResponse(
  req: IncomingMessage,
  res: ServerResponse,
  base = "http://localhost",
): string | null | undefined {
  const selector = readScopeSelectorQueryOrErrorResponse(req, res, base);
  return selector === null ? null : (selector.scopeId ?? selector.projectId);
}
