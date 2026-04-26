import { attentionQuery, queryKeys } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function AttentionPanel() {
  const queryClient = useQueryClient();
  const { data, error, isLoading, isFetching } = useQuery(attentionQuery);

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground">Loading attention...</div>
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
            queryClient.invalidateQueries({ queryKey: queryKeys.attention })
          }
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-xs text-muted-foreground">No attention data</div>
    );
  }

  const itemCount = data.data.items.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {itemCount === 0 ? (
          <Badge variant="success" className="h-5 text-[10px]">
            nothing pending
          </Badge>
        ) : (
          <Badge variant="warning" className="h-5 text-[10px]">
            {itemCount} item{itemCount === 1 ? "" : "s"}
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
