import type { OutboundHttpProfile, OutboundHttpProfileName } from "#core/outbound-http/types.js";

type OutboundHttpPolicy = {
  readonly targetRule:
    | "public-network-only"
    | "configured-origins-only"
    | "https-public-origins-only"
    | "loopback-only"
    | "exact-callback-url-only";
  readonly credentials: "allowed-on-selected-target";
  readonly redirects: {
    readonly maximum: number;
    readonly crossOrigin: "strip-to-safe-headers-and-reject-body-replay";
  };
  readonly timeoutMs: { readonly default: number; readonly maximum: number };
  readonly responseBytes: {
    readonly default: number;
    readonly maximum: number;
  };
  readonly retry: "idempotent-method-or-idempotency-key-on-transient-failure";
};

export const OUTBOUND_HTTP_POLICY_MATRIX = {
  "public-untrusted": {
    targetRule: "public-network-only",
    credentials: "allowed-on-selected-target",
    redirects: {
      maximum: 20,
      crossOrigin: "strip-to-safe-headers-and-reject-body-replay",
    },
    timeoutMs: { default: 30_000, maximum: 120_000 },
    responseBytes: { default: 1_048_576, maximum: 10_485_760 },
    retry: "idempotent-method-or-idempotency-key-on-transient-failure",
  },
  "configured-provider": {
    targetRule: "configured-origins-only",
    credentials: "allowed-on-selected-target",
    redirects: {
      maximum: 5,
      crossOrigin: "strip-to-safe-headers-and-reject-body-replay",
    },
    timeoutMs: { default: 30_000, maximum: 120_000 },
    responseBytes: { default: 10_000_000, maximum: 50_000_000 },
    retry: "idempotent-method-or-idempotency-key-on-transient-failure",
  },
  "oauth-protected-resource": {
    targetRule: "configured-origins-only",
    credentials: "allowed-on-selected-target",
    redirects: {
      maximum: 5,
      crossOrigin: "strip-to-safe-headers-and-reject-body-replay",
    },
    timeoutMs: { default: 30_000, maximum: 120_000 },
    responseBytes: { default: 1_000_000, maximum: 10_000_000 },
    retry: "idempotent-method-or-idempotency-key-on-transient-failure",
  },
  "oauth-metadata-endpoint": {
    targetRule: "https-public-origins-only",
    credentials: "allowed-on-selected-target",
    redirects: {
      maximum: 5,
      crossOrigin: "strip-to-safe-headers-and-reject-body-replay",
    },
    timeoutMs: { default: 30_000, maximum: 120_000 },
    responseBytes: { default: 1_000_000, maximum: 10_000_000 },
    retry: "idempotent-method-or-idempotency-key-on-transient-failure",
  },
  "daemon-loopback": {
    targetRule: "loopback-only",
    credentials: "allowed-on-selected-target",
    redirects: {
      maximum: 0,
      crossOrigin: "strip-to-safe-headers-and-reject-body-replay",
    },
    timeoutMs: { default: 5_000, maximum: 30_000 },
    responseBytes: { default: 10_000_000, maximum: 50_000_000 },
    retry: "idempotent-method-or-idempotency-key-on-transient-failure",
  },
  "explicit-callback": {
    targetRule: "exact-callback-url-only",
    credentials: "allowed-on-selected-target",
    redirects: {
      maximum: 0,
      crossOrigin: "strip-to-safe-headers-and-reject-body-replay",
    },
    timeoutMs: { default: 15_000, maximum: 60_000 },
    responseBytes: { default: 1_000_000, maximum: 10_000_000 },
    retry: "idempotent-method-or-idempotency-key-on-transient-failure",
  },
} as const satisfies Record<OutboundHttpProfileName, OutboundHttpPolicy>;

function normalizeHttpUrl(rawUrl: string, purpose: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TypeError(`${purpose} must be a valid HTTP(S) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${purpose} must use http:// or https://`);
  }
  if (url.username || url.password) {
    throw new TypeError(`${purpose} must not contain URL credentials`);
  }
  return url;
}

function configuredOrigins(rawOrigins: readonly string[], purpose: string): readonly string[] {
  const origins = [...new Set(rawOrigins.map((raw) => normalizeHttpUrl(raw, purpose).origin))];
  if (origins.length === 0) throw new TypeError(`${purpose} requires at least one origin`);
  return Object.freeze(origins);
}

function publicHttpsOrigins(rawOrigins: readonly string[], purpose: string): readonly string[] {
  const origins = [
    ...new Set(
      rawOrigins.map((raw) => {
        const url = normalizeHttpUrl(raw, purpose);
        if (url.protocol !== "https:") {
          throw new TypeError(`${purpose} must use https://`);
        }
        return url.origin;
      }),
    ),
  ];
  if (origins.length === 0) throw new TypeError(`${purpose} requires at least one origin`);
  return Object.freeze(origins);
}

function callbackUrls(rawUrls: readonly string[]): readonly string[] {
  const urls = [
    ...new Set(
      rawUrls.map((raw) => {
        const url = normalizeHttpUrl(raw, "callback URL");
        url.hash = "";
        return url.toString();
      }),
    ),
  ];
  if (urls.length === 0) throw new TypeError("callback profile requires at least one exact URL");
  return Object.freeze(urls);
}

export const OUTBOUND_HTTP_PROFILES = {
  publicUntrusted: Object.freeze({ name: "public-untrusted" } as const),
  configuredProvider: (origins: readonly string[]): OutboundHttpProfile =>
    Object.freeze({
      name: "configured-provider" as const,
      allowedOrigins: configuredOrigins(origins, "configured provider origin"),
    }),
  oauthProtectedResource: (origins: readonly string[]): OutboundHttpProfile =>
    Object.freeze({
      name: "oauth-protected-resource" as const,
      allowedOrigins: configuredOrigins(origins, "OAuth protected resource origin"),
    }),
  oauthMetadataEndpoint: (origins: readonly string[]): OutboundHttpProfile =>
    Object.freeze({
      name: "oauth-metadata-endpoint" as const,
      allowedOrigins: publicHttpsOrigins(origins, "OAuth metadata endpoint origin"),
    }),
  daemonLoopback: Object.freeze({ name: "daemon-loopback" } as const),
  explicitCallback: (urls: readonly string[]): OutboundHttpProfile =>
    Object.freeze({
      name: "explicit-callback" as const,
      allowedUrls: callbackUrls(urls),
    }),
} as const;

export function outboundHttpPolicy(profile: OutboundHttpProfileName): OutboundHttpPolicy {
  return OUTBOUND_HTTP_POLICY_MATRIX[profile];
}
