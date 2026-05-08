import { queryKeys } from "@/api/queries";
import { DaemonEventSource } from "@/api/sse";
import { useProjectId } from "@/lib/project-context";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export function useDaemonEvents() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const sourceRef = useRef<DaemonEventSource | null>(null);

  useEffect(() => {
    if (projectId === "") return;
    const source = new DaemonEventSource({ onStatusChange: setStatus });
    sourceRef.current = source;

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

    source.connect();

    return () => {
      source.disconnect();
      sourceRef.current = null;
    };
  }, [queryClient, projectId]);

  return status;
}
