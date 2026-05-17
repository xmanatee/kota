/**
 * Tracing module config slice.
 *
 * Owns the top-level `tracing` field — OpenTelemetry trace export
 * endpoint, security log export endpoint, and sampling configuration. Required `endpoint` enables
 * tracing; absent endpoint leaves it disabled.
 */

import { type ModuleConfigSlice, registerConfigSlice } from "#core/config/config-slice.js";

export type TracingConfig = {
  /** OTLP HTTP endpoint (e.g. "http://localhost:4318/v1/traces"). Required to enable. */
  endpoint: string;
  /** OTLP HTTP endpoint for metrics. Defaults to `endpoint`. */
  metricsEndpoint?: string;
  /** OTLP HTTP endpoint for security logs. Defaults to `endpoint` with `/v1/traces` or `/v1/metrics` replaced by `/v1/logs`. */
  logsEndpoint?: string;
  /** Metric flush interval. Default: 30 000. */
  metricsExportIntervalMs?: number;
  /** Sampling rate between 0 and 1. Default: 1.0. */
  samplingRate?: number;
  /** Service name reported in traces. Default: "kota". */
  serviceName?: string;
};

declare module "#core/config/config-slice.js" {
  interface KotaModuleConfigRegistry {
    tracing: TracingConfig;
  }
}

function sanitizeTracing(raw: unknown): TracingConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  if (typeof src.endpoint !== "string" || !src.endpoint) return undefined;
  const t: TracingConfig = { endpoint: src.endpoint };
  if (typeof src.metricsEndpoint === "string" && src.metricsEndpoint) t.metricsEndpoint = src.metricsEndpoint;
  if (typeof src.logsEndpoint === "string" && src.logsEndpoint) t.logsEndpoint = src.logsEndpoint;
  if (typeof src.metricsExportIntervalMs === "number" && src.metricsExportIntervalMs > 0) t.metricsExportIntervalMs = src.metricsExportIntervalMs;
  if (typeof src.samplingRate === "number" && src.samplingRate >= 0 && src.samplingRate <= 1) t.samplingRate = src.samplingRate;
  if (typeof src.serviceName === "string" && src.serviceName) t.serviceName = src.serviceName;
  return t;
}

export const tracingConfigSlice: ModuleConfigSlice<"tracing"> = {
  key: "tracing",
  description: "OpenTelemetry trace, metrics, and security log export config",
  sanitize: sanitizeTracing,
  merge: (base, override) => ({ ...base, ...override }),
  schemaSource: {
    relativePath: "src/modules/tracing/config-slice.ts",
    typeName: "TracingConfig",
  },
};

registerConfigSlice(tracingConfigSlice, "tracing");
