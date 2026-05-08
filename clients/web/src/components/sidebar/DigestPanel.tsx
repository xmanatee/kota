import { digestQuery, queryKeys } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProjectId } from "@/lib/project-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function DigestPanel() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { data, error, isLoading, isFetching } = useQuery(
    digestQuery(projectId),
  );

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground">Loading digest...</div>
    );
  }

  if (error) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs"
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.digest(projectId),
            })
          }
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return <div className="text-xs text-muted-foreground">No digest data</div>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {data.data.quiet ? (
          <Badge variant="secondary" className="h-5 text-[10px]">
            quiet window
          </Badge>
        ) : (
          <Badge variant="success" className="h-5 text-[10px]">
            active
          </Badge>
        )}
        {isFetching && (
          <span className="text-[10px] text-muted-foreground">refreshing</span>
        )}
      </div>
      <pre className="whitespace-pre-wrap rounded border border-border bg-muted/30 p-2 font-mono text-[11px] leading-snug text-foreground">
        {data.text}
      </pre>
    </div>
  );
}
