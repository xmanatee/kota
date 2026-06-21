import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";

const DASHBOARD_SESSION_COOKIE = "kota_dashboard_session";
const DASHBOARD_REQUEST_HEADER = "x-kota-dashboard-request";

type RequestAuthResult =
  | { kind: "open" }
  | { kind: "bearer" }
  | { kind: "dashboard-cookie" }
  | { kind: "unauthorized" };

export type RouteAuthResult =
  | Exclude<RequestAuthResult, { kind: "unauthorized" }>
  | { kind: "unauthorized" }
  | { kind: "dashboard-guard-missing" };

export class DaemonControlRequestAuthorizer {
  private readonly dashboardSessionToken: string | null;

  constructor(private readonly token?: string) {
    this.dashboardSessionToken = token ? randomBytes(32).toString("base64url") : null;
  }

  authorizeRoute(
    req: IncomingMessage,
    method: string,
    route: ControlRouteRegistration | RouteRegistration,
  ): RouteAuthResult {
    const auth = this.authorizeRequest(req);
    if (auth.kind !== "dashboard-cookie") return auth;
    if (!this.requiresDashboardRequestGuard(method, route)) return auth;
    if (this.hasDashboardRequestGuard(req)) return auth;
    return { kind: "dashboard-guard-missing" };
  }

  isDashboardEntry(method: string, path: string): boolean {
    return method === "GET" && (path === "/" || path === "/index.html");
  }

  setDashboardAuthCookie(res: ServerResponse): void {
    if (!this.dashboardSessionToken) return;
    res.setHeader(
      "Set-Cookie",
      `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(this.dashboardSessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
    );
  }

  private authorizeRequest(req: IncomingMessage): RequestAuthResult {
    if (!this.token) return { kind: "open" };
    const header = req.headers.authorization ?? "";
    if (header === `Bearer ${this.token}`) return { kind: "bearer" };
    if (
      this.dashboardSessionToken &&
      this.cookieValue(req, DASHBOARD_SESSION_COOKIE) === this.dashboardSessionToken
    ) {
      return { kind: "dashboard-cookie" };
    }
    return { kind: "unauthorized" };
  }

  private requiresDashboardRequestGuard(
    method: string,
    route: ControlRouteRegistration | RouteRegistration,
  ): boolean {
    if (method !== "GET") return true;
    return "capabilityScope" in route && route.capabilityScope === "control";
  }

  private hasDashboardRequestGuard(req: IncomingMessage): boolean {
    return this.headerIncludes(req, DASHBOARD_REQUEST_HEADER, "1") || this.hasSameOrigin(req);
  }

  private headerIncludes(req: IncomingMessage, name: string, expected: string): boolean {
    const value = req.headers[name];
    if (Array.isArray(value)) return value.includes(expected);
    return value === expected;
  }

  private hasSameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (typeof origin !== "string" || typeof host !== "string") return false;
    try {
      const url = new URL(origin);
      return url.host === host && (url.protocol === "http:" || url.protocol === "https:");
    } catch {
      return false;
    }
  }

  private cookieValue(req: IncomingMessage, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (rawName !== name) continue;
      return rawValue.join("=");
    }
    return undefined;
  }
}
