import { abortable } from "#core/outbound-http/abortable.js";
import { createDefaultOutboundHttpDispatcher } from "#core/outbound-http/dispatcher.js";
import { OutboundHttpTargetPolicyError, resolveOutboundAddresses, validateOutboundHttpTarget } from "#core/outbound-http/network-policy.js";
import { outboundHttpPolicy } from "#core/outbound-http/profiles.js";
import {
  isReplayableOutboundHttpBody,
  type PreparedOutboundHttpRequest,
  prepareOutboundHttpRequest,
  redirectedOutboundHttpMethod,
  retainCrossOriginSafeHeaders,
} from "#core/outbound-http/request-policy.js";
import { OutboundHttpBodyLimitError } from "#core/outbound-http/response-body.js";
import { failureRetryDisposition } from "#core/outbound-http/retry.js";
import {
  finalizeOutboundHttpResponse,
  type OutboundHttpResponseMode,
} from "#core/outbound-http/transport-response.js";
import { OutboundHttpRequestTelemetry } from "#core/outbound-http/transport-telemetry.js";
import {
  type OutboundHttpAddressResolver,
  type OutboundHttpDispatcher,
  OutboundHttpError,
  type OutboundHttpMethod,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
  type OutboundHttpStreamingOptions,
  type OutboundHttpStreamingResponse,
  type OutboundHttpTelemetrySink,
} from "#core/outbound-http/types.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_SAFE_METHODS = new Set<OutboundHttpMethod>(["GET", "HEAD", "OPTIONS"]);

export type OutboundHttpTransportOptions = {
  readonly dispatcher?: OutboundHttpDispatcher;
  readonly resolveAddresses?: OutboundHttpAddressResolver;
  readonly telemetry?: OutboundHttpTelemetrySink;
  readonly now?: () => number;
};

export class OutboundHttpTransport {
  readonly #resolveAddresses: OutboundHttpAddressResolver;
  readonly #dispatcher: OutboundHttpDispatcher;
  readonly #requestTelemetry: OutboundHttpRequestTelemetry;

  constructor(options: OutboundHttpTransportOptions = {}) {
    this.#resolveAddresses = options.resolveAddresses ?? resolveOutboundAddresses;
    this.#dispatcher = options.dispatcher ?? createDefaultOutboundHttpDispatcher(this.#resolveAddresses);
    this.#requestTelemetry = new OutboundHttpRequestTelemetry(
      options.telemetry ?? (() => {}),
      options.now ?? Date.now,
    );
  }

  async request(request: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    return this.#execute(request, "buffered");
  }

  async requestStream(
    request: OutboundHttpRequest,
    options: OutboundHttpStreamingOptions = {},
  ): Promise<OutboundHttpStreamingResponse> {
    return this.#execute(
      request,
      options.responseBodyLimit === "caller-managed"
        ? "caller-managed-streaming"
        : "profile-bounded-streaming",
    );
  }

  async #execute(request: OutboundHttpRequest, responseMode: "buffered"): Promise<OutboundHttpResponse>;
  async #execute(
    request: OutboundHttpRequest,
    responseMode: "profile-bounded-streaming" | "caller-managed-streaming",
  ): Promise<OutboundHttpStreamingResponse>;
  async #execute(
    request: OutboundHttpRequest,
    responseMode: OutboundHttpResponseMode,
  ): Promise<OutboundHttpResponse | OutboundHttpStreamingResponse> {
    const startedAt = this.#requestTelemetry.now();
    const method = request.method ?? "GET";
    let prepared: PreparedOutboundHttpRequest;
    try {
      prepared = prepareOutboundHttpRequest(request, method);
    } catch (error) {
      throw this.#failure(
        request,
        method,
        "invalid-request",
        error instanceof Error ? error.message : String(error),
        failureRetryDisposition(method, request.idempotencyKey, "policy"),
        startedAt,
      );
    }

    this.#requestTelemetry.started(request, method, prepared.url, prepared.headers);

    const controller = new AbortController();
    let termination: "caller" | "timeout" | undefined;
    const abortFromCaller = () => {
      if (termination !== undefined) return;
      termination = "caller";
    };
    if (request.signal?.aborted) abortFromCaller();
    else
      request.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });
    const signal = request.signal
      ? AbortSignal.any([request.signal, controller.signal])
      : controller.signal;
    const timeout = setTimeout(() => {
      if (signal.aborted) return;
      termination = "timeout";
      controller.abort(new Error("outbound HTTP request timed out"));
    }, prepared.timeoutMs);

    try {
      return await this.#requestWithRedirects(request, prepared, signal, startedAt, responseMode);
    } catch (error) {
      if (error instanceof OutboundHttpError) throw error;
      if (signal.aborted) {
        const timeoutReached = termination === "timeout";
        const code = timeoutReached ? "timeout" : "aborted";
        throw this.#failure(
          request,
          method,
          code,
          timeoutReached ? `request timed out after ${prepared.timeoutMs}ms` : "request was aborted by the caller",
          failureRetryDisposition(method, request.idempotencyKey, timeoutReached ? "timeout" : "aborted"),
          startedAt,
        );
      }
      if (error instanceof OutboundHttpTargetPolicyError) {
        throw this.#failure(
          request,
          method,
          "target-denied",
          error.message,
          failureRetryDisposition(method, request.idempotencyKey, "policy"),
          startedAt,
        );
      }
      if (error instanceof OutboundHttpBodyLimitError) {
        throw this.#failure(
          request,
          method,
          "response-too-large",
          error.message,
          failureRetryDisposition(method, request.idempotencyKey, "policy"),
          startedAt,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw this.#failure(
        request,
        method,
        "network",
        message,
        failureRetryDisposition(method, request.idempotencyKey, "network"),
        startedAt,
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async #requestWithRedirects(
    request: OutboundHttpRequest,
    prepared: PreparedOutboundHttpRequest,
    signal: AbortSignal,
    startedAt: number,
    responseMode: OutboundHttpResponseMode,
  ): Promise<OutboundHttpResponse | OutboundHttpStreamingResponse> {
    const policy = outboundHttpPolicy(request.profile.name);
    let currentUrl = prepared.url;
    let method = prepared.method;
    let headers = prepared.headers;
    let body = request.body;
    let redirected = false;

    for (let redirectCount = 0; ; redirectCount++) {
      await abortable(validateOutboundHttpTarget(currentUrl, request.profile, this.#resolveAddresses), signal);
      const response = await this.#dispatcher(
        currentUrl,
        {
          method,
          headers,
          body,
          signal,
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        },
        { profile: request.profile.name },
      );

      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return finalizeOutboundHttpResponse({
          request,
          prepared,
          method,
          url: currentUrl,
          response,
          redirected,
          startedAt,
          responseMode,
          telemetry: this.#requestTelemetry,
        });
      }

      await response.body?.cancel();
      if (redirectCount >= policy.redirects.maximum) {
        throw this.#policyFailure(request, method, "redirect-limit", "redirect limit exceeded", startedAt);
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw this.#policyFailure(request, method, "redirect-denied", "redirect location is not a valid URL", startedAt);
      }

      const previousMethod = method;
      method = redirectedOutboundHttpMethod(method, response.status);
      if (method !== previousMethod) {
        body = undefined;
        headers.delete("content-length");
        headers.delete("content-type");
      }
      if (nextUrl.origin !== currentUrl.origin) {
        if (body != null || !CROSS_ORIGIN_SAFE_METHODS.has(method)) {
          throw this.#policyFailure(
            request,
            method,
            "redirect-denied",
            "cross-origin redirect would replay a request body or state-changing method",
            startedAt,
          );
        }
        headers = retainCrossOriginSafeHeaders(headers);
      } else if (body != null && !isReplayableOutboundHttpBody(body)) {
        throw this.#policyFailure(request, method, "redirect-denied", "redirect would replay a streaming request body", startedAt);
      }
      currentUrl = nextUrl;
      redirected = true;
    }
  }

  #policyFailure(
    request: OutboundHttpRequest,
    method: OutboundHttpMethod,
    code: "redirect-denied" | "redirect-limit",
    message: string,
    startedAt: number,
  ): OutboundHttpError {
    return this.#failure(
      request,
      method,
      code,
      message,
      failureRetryDisposition(method, request.idempotencyKey, "policy"),
      startedAt,
    );
  }

  #failure(
    request: OutboundHttpRequest,
    method: OutboundHttpMethod,
    code: Parameters<OutboundHttpRequestTelemetry["failure"]>[2],
    message: string,
    retry: Parameters<OutboundHttpRequestTelemetry["failure"]>[4],
    startedAt: number,
  ): OutboundHttpError {
    return this.#requestTelemetry.failure(
      request,
      method,
      code,
      message,
      retry,
      startedAt,
    );
  }
}
