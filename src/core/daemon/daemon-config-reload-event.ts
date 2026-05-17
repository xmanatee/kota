import type { BusEvents } from "#core/events/event-bus-types.js";

type ConfigReloadEvent = BusEvents["daemon.config.reload"];

export function buildDaemonConfigReloadSuccessEvent(input: {
  changedModules: string[];
  isFullReload: boolean;
  workflowCount: number;
  timestamp?: string;
}): ConfigReloadEvent {
  const reloadKind =
    input.isFullReload ? "full" : input.changedModules.length > 0 ? "module-scoped" : "noop";
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    scope: "daemon",
    outcome: "success",
    reloadKind,
    fullReload: input.isFullReload,
    changedModules: input.changedModules,
    workflowCount: input.workflowCount,
  };
}

export function buildDaemonConfigReloadFailureEvent(input: {
  errorClass: string;
  workflowCount: number;
  timestamp?: string;
}): ConfigReloadEvent {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    scope: "daemon",
    outcome: "failure",
    reloadKind: "failed",
    fullReload: false,
    changedModules: [],
    workflowCount: input.workflowCount,
    errorClass: safeErrorClass(input.errorClass),
    errorMessage: "Config reload failed",
  };
}

function safeErrorClass(candidate: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(candidate) ? candidate : "Error";
}
