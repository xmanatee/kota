import type { PreparedOutboundHttpRequest } from "#core/outbound-http/request-policy.js";
import {
  boundedResponseFrom,
  boundedStreamingResponseFrom,
  OutboundHttpBodyLimitError,
  readOutboundHttpResponseBytes,
} from "#core/outbound-http/response-body.js";
import {
  failureRetryDisposition,
  responseRetryDisposition,
} from "#core/outbound-http/retry.js";
import type { OutboundHttpRequestTelemetry } from "#core/outbound-http/transport-telemetry.js";
import type {
  OutboundHttpMethod,
  OutboundHttpRequest,
  OutboundHttpResponse,
  OutboundHttpStreamingResponse,
} from "#core/outbound-http/types.js";

export type OutboundHttpResponseMode =
  | "buffered"
  | "profile-bounded-streaming"
  | "caller-managed-streaming";

type OutboundHttpResponseContext = {
  readonly request: OutboundHttpRequest;
  readonly prepared: PreparedOutboundHttpRequest;
  readonly method: OutboundHttpMethod;
  readonly url: URL;
  readonly response: Response;
  readonly redirected: boolean;
  readonly startedAt: number;
  readonly responseMode: OutboundHttpResponseMode;
  readonly telemetry: OutboundHttpRequestTelemetry;
};

export async function finalizeOutboundHttpResponse(
  context: OutboundHttpResponseContext,
): Promise<OutboundHttpResponse | OutboundHttpStreamingResponse> {
  const {
    request,
    prepared,
    method,
    url,
    response,
    redirected,
    startedAt,
    responseMode,
    telemetry,
  } = context;
  const retry = responseRetryDisposition(
    prepared.method,
    request.idempotencyKey,
    response.status,
    response.headers,
    telemetry.now(),
  );
  if (responseMode !== "buffered") {
    const boundedResponse = await boundedStreamingResponseFrom(
      response,
      responseMode === "caller-managed-streaming" ? null : prepared.responseBytes,
      (byteLength) => {
        telemetry.completed(
          request,
          method,
          url,
          response,
          redirected,
          byteLength,
          retry,
          startedAt,
        );
      },
      () => telemetry.failure(
        request,
        method,
        "response-too-large",
        new OutboundHttpBodyLimitError(prepared.responseBytes).message,
        failureRetryDisposition(method, request.idempotencyKey, "policy"),
        startedAt,
      ),
    );
    return {
      profile: request.profile.name,
      operation: request.operation,
      method,
      url: url.toString(),
      redirected,
      response: boundedResponse,
      retry,
    };
  }

  const bytes = await readOutboundHttpResponseBytes(response, prepared.responseBytes);
  const boundedResponse = boundedResponseFrom(response, bytes);
  telemetry.completed(
    request,
    method,
    url,
    response,
    redirected,
    bytes.byteLength,
    retry,
    startedAt,
  );
  return {
    profile: request.profile.name,
    operation: request.operation,
    method,
    url: url.toString(),
    redirected,
    response: boundedResponse,
    byteLength: bytes.byteLength,
    retry,
  };
}
