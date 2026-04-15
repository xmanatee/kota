import { schedulesQuery } from "@/api/queries";
import { useQuery } from "@tanstack/react-query";

export function SchedulesPanel() {
  const { data } = useQuery(schedulesQuery);
  const schedules = data?.schedules ?? [];

  if (schedules.length === 0) {
    return <div className="text-xs text-muted-foreground">No schedules</div>;
  }

  return (
    <div className="space-y-1">
      {schedules.map((s) => (
        <div key={s.id} className="text-xs">
          <div className="truncate">{s.description}</div>
          <div className="text-muted-foreground">
            {new Date(s.triggerAt).toLocaleString()}
            {s.repeatLabel && ` (${s.repeatLabel})`}
          </div>
        </div>
      ))}
    </div>
  );
}
