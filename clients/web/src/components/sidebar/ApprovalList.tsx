import { api } from "@/api/client";
import { approvalsQuery, queryKeys } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function ApprovalList() {
  const queryClient = useQueryClient();
  const { data } = useQuery(approvalsQuery);
  const approvals = (data?.approvals ?? []).filter(
    (a) => a.status === "pending",
  );

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.approveApproval(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectApproval(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
  });

  const approveAllMutation = useMutation({
    mutationFn: () => api.approveAll(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
  });

  if (approvals.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No pending approvals</div>
    );
  }

  return (
    <div className="space-y-2">
      {approvals.length > 1 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs"
          onClick={() => approveAllMutation.mutate()}
        >
          Approve all ({approvals.length})
        </Button>
      )}
      {approvals.map((a) => (
        <div key={a.id} className="rounded border border-border p-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Badge variant="warning">{a.tool}</Badge>
            <span className="truncate text-muted-foreground">{a.workflow}</span>
          </div>
          <div className="mt-1.5 flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => approveMutation.mutate(a.id)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => rejectMutation.mutate(a.id)}
            >
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
