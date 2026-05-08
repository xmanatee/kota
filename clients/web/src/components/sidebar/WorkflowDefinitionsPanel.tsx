import { api } from "@/api/client";
import { queryKeys, workflowDefinitionsQuery } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { useProjectId } from "@/lib/project-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function WorkflowDefinitionsPanel() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { data } = useQuery(workflowDefinitionsQuery(projectId));
  const definitions = data?.definitions ?? [];

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      enabled
        ? api.disableWorkflow(name, projectId)
        : api.enableWorkflow(name, projectId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflowDefinitions(projectId),
      }),
  });

  if (definitions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No workflow definitions
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {definitions.map((d) => {
        const effective = d.runtimeEnabled ?? d.enabled;
        return (
          <div key={d.name} className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() =>
                toggleMutation.mutate({ name: d.name, enabled: effective })
              }
              className={`h-3 w-3 rounded-full border ${effective ? "border-green-500 bg-green-500" : "border-muted-foreground"}`}
              title={effective ? "Disable" : "Enable"}
            />
            <span className="flex-1 truncate">{d.name}</span>
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {d.stepCount} steps
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
