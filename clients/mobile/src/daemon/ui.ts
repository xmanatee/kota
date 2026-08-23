import type {
  UiAction,
  UiJsonValue,
  UiSurfaceBundle,
} from './conformance/ui-surface.generated';
import { parseUiSurfaceBundle } from './conformance/ui-surface.generated';
import { daemonRequest, type DaemonHttp, withProject } from './http';

export type {
  UiAction,
  UiJsonValue,
  UiLogEntry,
  UiSurface,
  UiSurfaceBundle,
} from './conformance/ui-surface.generated';

export type UiActionExecutionResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; message: string };

export type UiDaemonRouteDocument = UiJsonValue;

export async function getUiSurfaces(
  http: DaemonHttp,
  projectId?: string,
): Promise<UiSurfaceBundle> {
  const raw = await daemonRequest<unknown>(
    http,
    withProject('/ui/surfaces', projectId),
  );
  return parseUiSurfaceBundle(raw);
}

export async function executeUiAction(
  http: DaemonHttp,
  action: UiAction,
  parameters?: UiJsonValue,
): Promise<UiActionExecutionResult> {
  const raw = await daemonRequest<unknown>(http, '/ui/actions/execute', {
    method: 'POST',
    body: JSON.stringify({
      scopeId: action.scopeId,
      surfaceId: action.surfaceId,
      actionId: action.actionId,
      ...(parameters === undefined ? {} : { parameters }),
    }),
  });
  return parseUiActionExecutionResult(raw);
}

export async function getUiDaemonRoute(
  http: DaemonHttp,
  path: string,
): Promise<UiDaemonRouteDocument> {
  if (!path.startsWith('/')) {
    throw new Error('Invalid UI daemon route: path must start with /.');
  }
  const raw = await daemonRequest<unknown>(http, path);
  return parseUiDaemonRouteDocument(raw);
}

export function parseUiDaemonRouteDocument(
  raw: unknown,
  path = '$',
): UiDaemonRouteDocument {
  if (
    raw === null ||
    typeof raw === 'string' ||
    typeof raw === 'boolean' ||
    (typeof raw === 'number' && Number.isFinite(raw))
  ) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.map((value, index) =>
      parseUiDaemonRouteDocument(value, `${path}[${index}]`),
    );
  }
  if (typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        parseUiDaemonRouteDocument(value, `${path}.${key}`),
      ]),
    );
  }
  throw new Error(`Invalid UI daemon route response at ${path}: expected JSON.`);
}

export function parseUiActionExecutionResult(
  raw: unknown,
): UiActionExecutionResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid UI action result: expected an object.');
  }
  const result = raw as {
    ok?: unknown;
    reason?: unknown;
    message?: unknown;
  };
  if (result.ok === true && typeof result.message === 'string') {
    return { ok: true, message: result.message };
  }
  if (
    result.ok === false &&
    typeof result.reason === 'string' &&
    typeof result.message === 'string'
  ) {
    return {
      ok: false,
      reason: result.reason,
      message: result.message,
    };
  }
  throw new Error('Invalid UI action result: unknown result arm.');
}
