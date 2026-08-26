import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
  OutboundHttpStreamingResponse,
  OutboundHttpTransport,
} from "#core/outbound-http/index.js";

export type OutboundHttpRequestHandler = (
  request: OutboundHttpRequest,
) => Promise<Response> | Response;

/**
 * Adapts a response-producing test handler to the narrow request port used by
 * outbound adapters. This is a protocol fixture, not a second transport: tests
 * that exercise policy use OutboundHttpTransport with an injected dispatcher.
 */
export function outboundHttpRequestPort(
  handler: OutboundHttpRequestHandler,
): Pick<OutboundHttpTransport, "request"> {
  return {
    async request(request): Promise<OutboundHttpResponse> {
      const response = await handler(request);
      return {
        profile: request.profile.name,
        operation: request.operation,
        method: request.method ?? "GET",
        url: String(request.url),
        redirected: false,
        response,
        byteLength: 0,
        retry: {
          eligible: false,
          reason: "response-not-transient",
        },
      };
    },
  };
}

export function outboundHttpStreamingPort(
  handler: OutboundHttpRequestHandler,
): Pick<OutboundHttpTransport, "request" | "requestStream"> {
  const requestPort = outboundHttpRequestPort(handler);
  return {
    request: requestPort.request.bind(requestPort),
    async requestStream(request): Promise<OutboundHttpStreamingResponse> {
      const response = await handler(request);
      return {
        profile: request.profile.name,
        operation: request.operation,
        method: request.method ?? "GET",
        url: String(request.url),
        redirected: false,
        response,
        retry: {
          eligible: false,
          reason: "response-not-transient",
        },
      };
    },
  };
}
