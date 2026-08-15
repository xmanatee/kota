import {
  redactOutboundHttpHeaders,
  redactOutboundHttpText,
  redactOutboundHttpUrl,
} from "#core/outbound-http/redaction.js";
import type {
  OutboundHttpFailure,
  OutboundHttpMethod,
  OutboundHttpRequest,
  OutboundHttpRetryDisposition,
  OutboundHttpTelemetrySink,
} from "#core/outbound-http/types.js";
import { OutboundHttpError } from "#core/outbound-http/types.js";

type OutboundHttpTransportFailureCode = Exclude<
  OutboundHttpFailure["code"],
  "http-status"
>;

export class OutboundHttpRequestTelemetry {
  readonly #telemetry: OutboundHttpTelemetrySink;
  readonly #now: () => number;

  constructor(telemetry: OutboundHttpTelemetrySink, now: () => number) {
    this.#telemetry = telemetry;
    this.#now = now;
  }

  now(): number {
    return this.#now();
  }

  started(
    request: OutboundHttpRequest,
    method: OutboundHttpMethod,
    url: URL,
    headers: Headers,
  ): void {
    this.#telemetry({
      type: "request-started",
      profile: request.profile.name,
      operation: request.operation,
      method,
      url: redactOutboundHttpUrl(url.toString()),
      headers: redactOutboundHttpHeaders(headers),
    });
  }

  completed(
    request: OutboundHttpRequest,
    method: OutboundHttpMethod,
    url: URL,
    response: Response,
    redirected: boolean,
    responseBytes: number,
    retry: OutboundHttpRetryDisposition,
    startedAt: number,
  ): void {
    this.#telemetry({
      type: "request-completed",
      profile: request.profile.name,
      operation: request.operation,
      method,
      url: redactOutboundHttpUrl(url.toString()),
      status: response.status,
      ok: response.ok,
      redirected,
      responseBytes,
      durationMs: this.#now() - startedAt,
      retry,
    });
  }

  failure(
    request: OutboundHttpRequest,
    method: OutboundHttpMethod,
    code: OutboundHttpTransportFailureCode,
    message: string,
    retry: OutboundHttpRetryDisposition,
    startedAt: number,
  ): OutboundHttpError {
    const url = redactOutboundHttpUrl(String(request.url));
    const failure: OutboundHttpFailure = {
      code,
      profile: request.profile.name,
      operation: request.operation,
      method,
      url,
      retry,
    };
    this.#telemetry({
      type: "request-failed",
      profile: request.profile.name,
      operation: request.operation,
      method,
      url,
      code,
      durationMs: this.#now() - startedAt,
      retry,
    });
    return new OutboundHttpError(
      `${code}: ${redactOutboundHttpText(message)} (${url})`,
      failure,
    );
  }
}
