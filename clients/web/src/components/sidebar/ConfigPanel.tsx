import { configQuery } from "@/api/queries";
import { useProjectId } from "@/lib/project-context";
import { useQuery } from "@tanstack/react-query";

export function ConfigPanel() {
  const projectId = useProjectId();
  const { data } = useQuery(configQuery(projectId));

  if (!data || Object.keys(data).length === 0) {
    return <div className="text-xs text-muted-foreground">No config</div>;
  }

  return (
    <div className="space-y-1 text-xs">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex justify-between">
          <span className="text-muted-foreground">{key}</span>
          <span className="truncate text-right max-w-[120px]">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}
