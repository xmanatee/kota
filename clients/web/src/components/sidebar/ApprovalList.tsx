import { api } from "@/api/client";
import { approvalsQuery, queryKeys } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProjectId } from "@/lib/project-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function ApprovalList() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { data } = useQuery(approvalsQuery(projectId));
  const approvals = (data?.approvals ?? []).filter(
    (a) => a.status === "pending",
  );
  const allReviewable = approvals.every((a) => a.review.status === "available");

  const approveMutation = useMutation({
    mutationFn: ({ id, digest }: { id: string; digest: string }) =>
      api.approveApproval(projectId, id, digest),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvals(projectId),
      }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectApproval(projectId, id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvals(projectId),
      }),
  });

  const approveAllMutation = useMutation({
    mutationFn: () =>
      api.approveAll(
        projectId,
        approvals.flatMap((approval) =>
          approval.review.status === "available"
            ? [{ id: approval.id, digest: approval.review.digest }]
            : [],
        ),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvals(projectId),
      }),
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
          disabled={!allReviewable || approveAllMutation.isPending}
        >
          Approve all ({approvals.length})
        </Button>
      )}
      {approvals.map((a) => (
        <div key={a.id} className="rounded border border-border p-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Badge variant="warning">{a.tool}</Badge>
            <span className="text-muted-foreground">{a.risk}</span>
          </div>
          <p className="mt-1.5 text-muted-foreground">{a.reason}</p>
          {a.review.status === "available" ? (
            <>
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">
                {JSON.stringify(a.review.input, null, 2)}
              </pre>
              {a.review.context !== undefined && (
                <div className="mt-1.5 rounded bg-muted p-2 text-[11px] text-muted-foreground">
                  <div className="mb-1 font-medium">Conversation context</div>
                  <pre className="whitespace-pre-wrap break-words font-mono">
                    {a.review.context}
                  </pre>
                </div>
              )}
              <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                Review digest: {a.review.digest}
              </div>
            </>
          ) : (
            <p className="mt-1.5 text-destructive">
              Input unavailable after daemon restart. Reject and retry the tool
              call.
            </p>
          )}
          <div className="mt-1.5 flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => {
                if (a.review.status === "available") {
                  approveMutation.mutate({
                    id: a.id,
                    digest: a.review.digest,
                  });
                }
              }}
              disabled={
                a.review.status !== "available" || approveMutation.isPending
              }
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
