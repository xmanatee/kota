import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type * as Notifications from 'expo-notifications';
import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import {
  parseUiSurfaceBundle,
  type UiAction,
  type UiSurface,
  type UiSurfaceBundle,
} from '../daemon/ui-surface.generated';

export type FetchCall = {
  url: string;
  method: string;
  authorization: string | null;
  body?: string;
};

export type NotificationListener = Parameters<
  typeof Notifications.addNotificationResponseReceivedListener
>[0];

export const DAEMON_URL = 'http://127.0.0.1:8765';
export const DAEMON_TOKEN = 'production-journey-token';
export const contractBundle = parseUiSurfaceBundle(
  fixture.operatorBundle,
);
const identity = {
  scopeName: 'kota',
  scopeRoot: '/workspace/kota',
  scopeRegistry: {
    rootScopeId: 'global',
    defaultScopeId: 'scope-fixture',
    scopes: [
      { scopeId: 'global', displayName: 'Global' },
      {
        scopeId: 'scope-fixture',
        displayName: 'kota',
        parentScopeId: 'global',
        directoryRoot: '/workspace/kota',
      },
    ],
  },
  daemonVersion: '0.1.0',
  pid: 12345,
  startedAt: '2026-04-29T01:00:00.000Z',
  dashboard: { available: true, path: '/' },
};
export const sseRequests: MockSseRequest[] = [];

const capturedBundlePath = process.env.KOTA_UI_SURFACE_EVIDENCE_BUNDLE;

export function loadJourneyBundle(): UiSurfaceBundle {
  if (capturedBundlePath) {
    return parseUiSurfaceBundle(
      JSON.parse(readFileSync(capturedBundlePath, 'utf8')),
    );
  }
  return {
    ...contractBundle,
    surfaces: contractBundle.surfaces.map((surface) =>
      surface.surfaceId === 'operator-control'
        ? { ...surface, refreshEvents: ['workflow.completed'] }
        : surface,
    ),
  };
}

export function findLaunchAction(bundle: UiSurfaceBundle): {
  surface: UiSurface;
  action: UiAction;
} {
  for (const surface of bundle.surfaces) {
    const action = surface.actions.find(
      (candidate) => candidate.actionId === 'workflow.launch',
    );
    if (action) return { surface, action };
  }
  throw new Error('The shared bundle does not expose workflow.launch.');
}

export function createDaemonRequestHandler(
  getBundle: () => UiSurfaceBundle,
  fetchCalls: FetchCall[],
) {
  return async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    const parsed = new URL(url);
    const headers = new Headers(init.headers);
    fetchCalls.push({
      url,
      method: init.method ?? 'GET',
      authorization: headers.get('Authorization'),
      ...(typeof init.body === 'string' ? { body: init.body } : {}),
    });

    switch (parsed.pathname) {
      case '/health':
        return jsonResponse({ ok: true });
      case '/identity':
        return jsonResponse(identity);
      case '/ui/surfaces':
        return jsonResponse(getBundle());
      case '/ui/actions/execute':
        return jsonResponse({ ok: true, message: 'Action completed.' });
      case '/status':
        return jsonResponse({ online: true, paused: false });
      case '/workflow/runs':
        return jsonResponse({ runs: [] });
      case '/approvals':
        return jsonResponse({ approvals: [] });
      case '/tasks':
        return jsonResponse({ counts: {}, tasks: {} });
      case '/owner-questions':
        return jsonResponse({ questions: [] });
      default:
        throw new Error(`Unexpected production journey request: ${url}`);
    }
  };
}

export function notificationResponse(data: Record<string, string>) {
  return {
    notification: {
      request: { content: { data } },
    },
  } as Parameters<NotificationListener>[0];
}

export function callsForPath(
  fetchCalls: FetchCall[],
  path: string,
): FetchCall[] {
  return fetchCalls.filter((call) => new URL(call.url).pathname === path);
}

export function evidenceBundleSource(): string {
  if (!capturedBundlePath) {
    return 'scripts/ui-behavior-vectors.mjs#operatorBundle';
  }
  return relative(join(process.cwd(), '..', '..'), capturedBundlePath);
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response);
}

export class MockSseRequest {
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readyState = 0;
  status = 0;
  responseText = '';
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private requestHeaders = new Map<string, string>();

  constructor() {
    sseRequests.push(this);
  }

  open(): void {}

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.set(name, value);
  }

  send(): void {
    const authorization = this.requestHeaders.get('Authorization');
    if (authorization !== `Bearer ${DAEMON_TOKEN}`) {
      throw new Error(`Unexpected SSE authorization: ${authorization}`);
    }
    this.status = 200;
    this.readyState = MockSseRequest.HEADERS_RECEIVED;
    this.onreadystatechange?.();
  }

  abort(): void {
    this.readyState = MockSseRequest.DONE;
  }

  emit(type: string, payload: Record<string, string>): void {
    this.responseText += `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    this.readyState = MockSseRequest.LOADING;
    this.onreadystatechange?.();
  }
}
