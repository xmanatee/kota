import { queryKeys } from "@/api/queries";
import { DaemonEventSource } from "@/api/sse";
import { useProjectId } from "@/lib/project-context";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  UiLogEntry,
  UiNode,
  UiSurfaceBundle,
} from "../../../conformance/ui-surface.generated";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export type LiveUiLogEntries = Readonly<Record<string, readonly UiLogEntry[]>>;

export type DaemonEventState = {
  status: ConnectionStatus;
  liveLogEntries: LiveUiLogEntries;
};

type UiEventSubscriptions = {
  eventTypes: readonly string[];
  key: string;
  streamIdsByEvent: ReadonlyMap<string, readonly string[]>;
};

const uiSubscriptionCache = new Map<string, UiEventSubscriptions>();
const MAX_UI_SUBSCRIPTION_CACHE_SIZE = 32;

export function useDaemonEvents(bundle?: UiSurfaceBundle): DaemonEventState {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [liveLogEntries, setLiveLogEntries] = useState<LiveUiLogEntries>({});
  const sourceRef = useRef<DaemonEventSource | null>(null);
  const uiSubscriptions = collectUiEventSubscriptions(bundle);

  useEffect(() => {
    if (projectId === "") {
      setStatus("disconnected");
      setLiveLogEntries({});
      return;
    }
    setLiveLogEntries({});
    const source = new DaemonEventSource({
      onStatusChange: setStatus,
      onMalformedEvent: ({ error, event }) => {
        console.warn(`Malformed daemon event "${event}": ${error.message}`);
      },
    });
    sourceRef.current = source;

    const invalidateUiSurfaces = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.uiSurfaces(projectId),
      });
    };

    const invalidateWorkflows = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowStatus(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["workflowRuns", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowDefinitions(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.daemonStatus(projectId),
      });
    };

    source.on("workflow.started", invalidateWorkflows);
    source.on("workflow.completed", invalidateWorkflows);
    source.on("workflow.step.completed", invalidateWorkflows);
    source.on("queue.changed", invalidateWorkflows);
    source.on("approval.changed", () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.approvals(projectId),
      });
    });
    const invalidateOwnerQuestions = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ownerQuestions(projectId),
      });
    };
    source.on("owner.question.asked", invalidateOwnerQuestions);
    source.on("owner.question.changed", invalidateOwnerQuestions);
    source.on("owner.question.resolved", invalidateOwnerQuestions);
    source.on("owner.question.dismissed", invalidateOwnerQuestions);
    source.on("owner.question.expired", invalidateOwnerQuestions);
    source.on("task.changed", () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tasks(projectId),
      });
    });
    source.on("session.registered", () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(projectId),
      });
    });
    source.on("session.unregistered", () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(projectId),
      });
    });

    for (const eventType of uiSubscriptions.eventTypes) {
      source.on(eventType, (payload) => {
        invalidateUiSurfaces();
        const streamIds = uiSubscriptions.streamIdsByEvent.get(eventType);
        if (!streamIds || streamIds.length === 0) return;
        const entry = uiLogEntry(eventType, payload);
        setLiveLogEntries((current) => {
          const next = { ...current };
          for (const streamId of streamIds) {
            next[streamId] = [...(current[streamId] ?? []), entry].slice(-100);
          }
          return next;
        });
      });
    }

    source.connect();

    return () => {
      source.disconnect();
      sourceRef.current = null;
    };
  }, [queryClient, projectId, uiSubscriptions]);

  return { status, liveLogEntries };
}

function collectUiEventSubscriptions(
  bundle?: UiSurfaceBundle,
): UiEventSubscriptions {
  const eventTypes = new Set<string>();
  const streams = new Map<string, Set<string>>();
  for (const surface of bundle?.surfaces ?? []) {
    for (const eventType of surface.refreshEvents ?? [])
      eventTypes.add(eventType);
    collectNodeStreams(surface.nodes, eventTypes, streams);
  }
  const sortedEventTypes = [...eventTypes].sort();
  const sortedStreams = [...streams]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([eventType, streamIds]) => [eventType, [...streamIds].sort()] as const,
    );
  const key = JSON.stringify([sortedEventTypes, sortedStreams]);
  const cached = uiSubscriptionCache.get(key);
  if (cached) return cached;
  const subscriptions: UiEventSubscriptions = {
    eventTypes: sortedEventTypes,
    key,
    streamIdsByEvent: new Map(sortedStreams),
  };
  uiSubscriptionCache.set(key, subscriptions);
  if (uiSubscriptionCache.size > MAX_UI_SUBSCRIPTION_CACHE_SIZE) {
    const oldestKey = uiSubscriptionCache.keys().next().value;
    if (oldestKey !== undefined) uiSubscriptionCache.delete(oldestKey);
  }
  return subscriptions;
}

function collectNodeStreams(
  nodes: readonly UiNode[],
  eventTypes: Set<string>,
  streams: Map<string, Set<string>>,
): void {
  for (const node of nodes) {
    if (node.kind === "tabs") {
      for (const tab of node.tabs) {
        collectNodeStreams(tab.nodes, eventTypes, streams);
      }
      continue;
    }
    if (node.kind !== "log-stream") continue;
    for (const eventType of node.source.eventTypes) {
      eventTypes.add(eventType);
      const streamIds = streams.get(eventType) ?? new Set<string>();
      streamIds.add(node.streamId);
      streams.set(eventType, streamIds);
    }
  }
}

function uiLogEntry(
  eventType: string,
  payload: Record<string, unknown>,
): UiLogEntry {
  return {
    timestamp:
      typeof payload.timestamp === "string"
        ? payload.timestamp
        : new Date().toISOString(),
    level: uiLogLevel(payload.level),
    source: eventType,
    message:
      typeof payload.message === "string"
        ? payload.message
        : eventPayloadSummary(payload),
  };
}

function uiLogLevel(value: unknown): UiLogEntry["level"] {
  return value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
    ? value
    : "info";
}

function eventPayloadSummary(payload: Record<string, unknown>): string {
  const fields = Object.entries(payload)
    .filter(
      ([, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    )
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`);
  return fields.length > 0 ? fields.join(" · ") : "Event received.";
}
