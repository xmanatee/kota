import { tasksQuery } from "@/api/queries";
import type { DaemonTaskDetail } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { useProjectId } from "@/lib/project-context";
import { useQuery } from "@tanstack/react-query";

export function BlockedWorkPanel() {
  const projectId = useProjectId();
  const { data } = useQuery(tasksQuery(projectId));
  const blocked = data?.tasks.blocked ?? [];

  if (blocked.length === 0) {
    return <div className="text-xs text-muted-foreground">No blocked work</div>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs">
        <Badge variant="warning" className="h-4 px-1.5 text-[10px]">
          {blocked.length}
        </Badge>
        <span className="font-medium">Blocked work</span>
      </div>
      <div className="space-y-1">
        {blocked.slice(0, 3).map((task) => (
          <BlockedTaskRow key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

function BlockedTaskRow({ task }: { task: DaemonTaskDetail }) {
  return (
    <div className="rounded border border-border px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-yellow-600 dark:text-yellow-400">
          {task.priority}
        </span>
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
      </div>
      {task.summary && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {task.summary}
        </div>
      )}
    </div>
  );
}
