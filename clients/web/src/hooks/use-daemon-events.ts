import { queryKeys } from "@/api/queries";
import { DaemonEventSource } from "@/api/sse";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export function useDaemonEvents() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const sourceRef = useRef<DaemonEventSource | null>(null);

  useEffect(() => {
    const source = new DaemonEventSource({ onStatusChange: setStatus });
    sourceRef.current = source;

    const invalidateWorkflows = () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowStatus,
      });
      void queryClient.invalidateQueries({ queryKey: ["workflowRuns"] });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowDefinitions,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules });
      void queryClient.invalidateQueries({ queryKey: queryKeys.daemonStatus });
    };

    source.on("workflow.started", invalidateWorkflows);
    source.on("workflow.completed", invalidateWorkflows);
    source.on("workflow.step.completed", invalidateWorkflows);
    source.on("queue.changed", invalidateWorkflows);
    source.on("approval.changed", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
    });
    source.on("task.changed", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    });
    source.on("session.registered", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    });
    source.on("session.unregistered", () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    });

    source.connect();

    return () => {
      source.disconnect();
      sourceRef.current = null;
    };
  }, [queryClient]);

  return status;
}
