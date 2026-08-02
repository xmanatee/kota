import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleRouteHandler,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { jsonResponse } from "./daemon-control-utils.js";

/** Normalizes synchronous and asynchronous failures from contributed routes. */
export class DaemonControlRouteInvoker {
  invokeRouteHandler(
    route: ControlRouteRegistration | RouteRegistration,
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): void {
    this.invoke(route.handler, req, res, params);
  }

  invokeAuthFailureHandler(
    route: ControlRouteRegistration | RouteRegistration,
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): boolean {
    if (!route.authFailureHandler) return false;
    this.invoke(route.authFailureHandler, req, res, params);
    return true;
  }

  private invoke(
    handler: ModuleRouteHandler,
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): void {
    const onRejected = (error: Error | string) => this.handleError(res, error);
    try {
      Promise.resolve(handler(req, res, params)).catch(onRejected);
    } catch (error) {
      this.handleError(res, error instanceof Error ? error : String(error));
    }
  }

  private handleError(res: ServerResponse, error: Error | string): void {
    if (res.headersSent) return;
    jsonResponse(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
