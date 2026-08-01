import { abortable } from "#core/outbound-http/abortable.js";
import { createDefaultOutboundHttpDispatcher } from "#core/outbound-http/dispatcher.js";
import { OutboundHttpTargetPolicyError, resolveOutboundAddresses, validateOutboundHttpTarget } from "#core/outbound-http/network-policy.js";
import { outboundHttpPolicy } from "#core/outbound-http/profiles.js";
import { redactOutboundHttpHeaders, redactOutboundHttpText, redactOutboundHttpUrl } from "#core/outbound-http/redaction.js";
import {
  isReplayableOutboundHttpBody,
  type PreparedOutboundHttpRequest,
  prepareOutboundHttpRequest,
  redirectedOutboundHttpMethod,
  retainCrossOriginSafeHeaders,
} from "#core/outbound-http/request-policy.js";
import { boundedResponseFrom, OutboundHttpBodyLimitError, readOutboundHttpResponseBytes } from "#core/outbound-http/response-body.js";
import { failureRetryDisposition, responseRetryDisposition } from "#core/outbound-http/retry.js";
import {
  type OutboundHttpAddressResolver,
  type OutboundHttpDispatcher,
  OutboundHttpError,
  type OutboundHttpFailure,
  type OutboundHttpMethod,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
  type OutboundHttpRetryDisposition,
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
  readonly #telemetry: OutboundHttpTelemetrySink;
  readonly #now: () => number;

  constructor(options: OutboundHttpTransportOptions = {}) {
    this.#resolveAddresses = options.resolveAddresses ?? resolveOutboundAddresses;
    this.#dispatcher = options.dispatcher ?? createDefaultOutboundHttpDispatcher(this.#resolveAddresses);
    this.#telemetry = options.telemetry ?? (() => {});
    this.#now = options.now ?? Date.now;
  }

  async request(request: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    const startedAt = this.#now();
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

    this.#telemetry({
      type: "request-started",
      profile: request.profile.name,
      operation: request.operation,
      method,
      url: redactOutboundHttpUrl(prepared.url.toString()),
      headers: redactOutboundHttpHeaders(prepared.headers),
    });

    const controller = new AbortController();
    let termination: "caller" | "timeout" | undefined;
    const abortFromCaller = () => {
      if (controller.signal.aborted) return;
      termination = "caller";
      controller.abort(request.signal?.reason);
    };
    if (request.signal?.aborted) abortFromCaller();
    else
      request.signal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });
    const timeout = setTimeout(() => {
      if (controller.signal.aborted) return;
      termination = "timeout";
      controller.abort(new Error("outbound HTTP request timed out"));
    }, prepared.timeoutMs);

    try {
      return await this.#requestWithRedirects(request, prepared, controller.signal, startedAt);
    } catch (error) {
      if (error instanceof OutboundHttpError) throw error;
      if (controller.signal.aborted) {
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
  ): Promise<OutboundHttpResponse> {
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
        const bytes = await readOutboundHttpResponseBytes(response, prepared.responseBytes);
        const retry = responseRetryDisposition(prepared.method, request.idempotencyKey, response.status, response.headers, this.#now());
        const boundedResponse = boundedResponseFrom(response, bytes);
        this.#telemetry({
          type: "request-completed",
          profile: request.profile.name,
          operation: request.operation,
          method,
          url: redactOutboundHttpUrl(currentUrl.toString()),
          status: response.status,
          ok: response.ok,
          redirected,
          responseBytes: bytes.byteLength,
          durationMs: this.#now() - startedAt,
          retry,
        });
        return {
          profile: request.profile.name,
          operation: request.operation,
          method,
          url: currentUrl.toString(),
          redirected,
          response: boundedResponse,
          byteLength: bytes.byteLength,
          retry,
        };
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
    return this.#failure(request, method, code, message, failureRetryDisposition(method, request.idempotencyKey, "policy"), startedAt);
  }

  #failure(
    request: OutboundHttpRequest,
    method: OutboundHttpMethod,
    code: Exclude<OutboundHttpFailure["code"], "http-status">,
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
    return new OutboundHttpError(`${code}: ${redactOutboundHttpText(message)} (${url})`, failure);
  }
}
