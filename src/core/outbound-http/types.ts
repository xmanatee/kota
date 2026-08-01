export const OUTBOUND_HTTP_PROFILE_NAMES = [
  "public-untrusted",
  "configured-provider",
  "oauth-protected-resource",
  "daemon-loopback",
  "explicit-callback",
] as const;

export type OutboundHttpProfileName = (typeof OUTBOUND_HTTP_PROFILE_NAMES)[number];

export type OutboundHttpProfile =
  | { readonly name: "public-untrusted" }
  | {
      readonly name: "configured-provider";
      readonly allowedOrigins: readonly string[];
    }
  | {
      readonly name: "oauth-protected-resource";
      readonly allowedOrigins: readonly string[];
    }
  | { readonly name: "daemon-loopback" }
  | {
      readonly name: "explicit-callback";
      readonly allowedUrls: readonly string[];
    };

export type OutboundHttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export type OutboundHttpRequestLimits = {
  /** A profile-bounded request deadline. Values above the profile maximum fail closed. */
  readonly timeoutMs?: number;
  /** A profile-bounded strict response limit. Values above the profile maximum fail closed. */
  readonly responseBytes?: number;
};

export type OutboundHttpRequest = {
  readonly profile: OutboundHttpProfile;
  readonly operation: string;
  readonly url: string | URL;
  readonly method?: OutboundHttpMethod;
  readonly headers?: HeadersInit;
  readonly body?: BodyInit | null;
  readonly signal?: AbortSignal;
  readonly limits?: OutboundHttpRequestLimits;
  /** Makes POST/PATCH retry-eligible and is added as the Idempotency-Key header. */
  readonly idempotencyKey?: string;
};

export type OutboundHttpRetryDisposition =
  | {
      readonly eligible: false;
      readonly reason: "method-not-idempotent" | "response-not-transient" | "policy-rejection" | "caller-aborted";
    }
  | {
      readonly eligible: true;
      readonly reason: "transient-response" | "network-failure" | "timeout";
      readonly retryAfterMs: number | null;
    };

export type OutboundHttpResponse = {
  readonly profile: OutboundHttpProfileName;
  readonly operation: string;
  readonly method: OutboundHttpMethod;
  readonly url: string;
  readonly redirected: boolean;
  readonly response: Response;
  readonly byteLength: number;
  readonly retry: OutboundHttpRetryDisposition;
};

type OutboundHttpFailureBase = {
  readonly profile: OutboundHttpProfileName;
  readonly operation: string;
  readonly method: OutboundHttpMethod;
  readonly url: string;
  readonly retry: OutboundHttpRetryDisposition;
};

export type OutboundHttpFailure = OutboundHttpFailureBase &
  (
    | {
        readonly code: "invalid-request" | "target-denied" | "redirect-denied" | "redirect-limit" | "response-too-large";
      }
    | { readonly code: "timeout" | "aborted" | "network" }
    | {
        readonly code: "http-status";
        readonly status: number;
        readonly statusText: string;
        readonly responseBody: string;
      }
  );

export class OutboundHttpError extends Error {
  readonly failure: OutboundHttpFailure;

  constructor(message: string, failure: OutboundHttpFailure) {
    super(message);
    this.name = "OutboundHttpError";
    this.failure = failure;
  }
}

export type OutboundHttpTelemetryEvent =
  | {
      readonly type: "request-started";
      readonly profile: OutboundHttpProfileName;
      readonly operation: string;
      readonly method: OutboundHttpMethod;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "request-completed";
      readonly profile: OutboundHttpProfileName;
      readonly operation: string;
      readonly method: OutboundHttpMethod;
      readonly url: string;
      readonly status: number;
      readonly ok: boolean;
      readonly redirected: boolean;
      readonly responseBytes: number;
      readonly durationMs: number;
      readonly retry: OutboundHttpRetryDisposition;
    }
  | {
      readonly type: "request-failed";
      readonly profile: OutboundHttpProfileName;
      readonly operation: string;
      readonly method: OutboundHttpMethod;
      readonly url: string;
      readonly code: Exclude<OutboundHttpFailure["code"], "http-status">;
      readonly durationMs: number;
      readonly retry: OutboundHttpRetryDisposition;
    };

export type OutboundHttpTelemetrySink = (event: OutboundHttpTelemetryEvent) => void;

export type OutboundHttpDispatchContext = {
  readonly profile: OutboundHttpProfileName;
};

export type OutboundHttpDispatcher = (url: URL, init: RequestInit, context: OutboundHttpDispatchContext) => Promise<Response>;

export type ResolvedOutboundAddress = {
  readonly address: string;
  readonly family: 4 | 6;
};

export type OutboundHttpAddressResolver = (hostname: string) => Promise<readonly ResolvedOutboundAddress[]>;
