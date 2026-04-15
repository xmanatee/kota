import { modulesQuery } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

export function ModulesPanel() {
  const { data } = useQuery(modulesQuery);
  const modules = data?.modules ?? [];

  if (modules.length === 0) {
    return <div className="text-xs text-muted-foreground">No modules</div>;
  }

  return (
    <div className="space-y-1">
      {modules.map((m) => (
        <div key={m.name} className="flex items-center gap-1.5 text-xs">
          <div
            className={`h-2 w-2 rounded-full ${!m.health || m.health.status === "ok" ? "bg-green-500" : "bg-yellow-500"}`}
          />
          <span className="flex-1 truncate">{m.name}</span>
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {m.version}
          </Badge>
        </div>
      ))}
    </div>
  );
}
