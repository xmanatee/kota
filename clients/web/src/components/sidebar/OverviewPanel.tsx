import { daemonStatusQuery, workflowRunsQuery } from "@/api/queries";
import { modulesQuery } from "@/api/queries";
import { fmtUptime } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export function OverviewPanel() {
  const { data: daemonData } = useQuery(daemonStatusQuery);
  const { data: runsData } = useQuery(workflowRunsQuery({ limit: 50 }));
  const { data: modulesData } = useQuery(modulesQuery);

  const daemon = daemonData?.daemon;
  const runs = runsData?.runs ?? [];
  const modules = modulesData?.modules ?? [];

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const dailySpend = runs
    .filter((r) => r.startedAt && new Date(r.startedAt).getTime() >= oneDayAgo)
    .reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0);

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentRuns = runs.filter(
    (r) => r.startedAt && new Date(r.startedAt).getTime() >= oneHourAgo,
  );
  const successCount = recentRuns.filter((r) => r.status === "success").length;
  const failedCount = recentRuns.filter(
    (r) => r.status === "failed" || r.status === "interrupted",
  ).length;
  const warnCount = recentRuns.filter(
    (r) => r.status === "completed-with-warnings",
  ).length;

  const okModules = modules.filter(
    (m) => !m.health || m.health.status === "ok",
  ).length;
  const degradedModules = modules.filter(
    (m) => m.health && m.health.status !== "ok",
  ).length;

  return (
    <div className="space-y-1 text-xs">
      <Row
        label="Daemon"
        value={
          daemon?.running !== false
            ? `up ${fmtUptime(daemon?.startedAt ?? "")}`
            : "offline"
        }
        ok={daemon?.running !== false}
      />
      <Row
        label="Dispatch"
        value={
          !daemon
            ? "\u2014"
            : daemon.workflow.paused
              ? "paused"
              : daemon.workflow.dispatchWindowBlocked
                ? "window blocked"
                : "open"
        }
        ok={
          daemon
            ? !daemon.workflow.paused && !daemon.workflow.dispatchWindowBlocked
            : false
        }
      />
      <Row label="24h spend" value={`$${dailySpend.toFixed(3)}`} />
      <Row
        label="Runs (1h)"
        value={
          [
            successCount > 0 && `\u2713 ${successCount}`,
            warnCount > 0 && `\u26A0 ${warnCount}`,
            failedCount > 0 && `\u2717 ${failedCount}`,
          ]
            .filter(Boolean)
            .join(" ") || "\u2014"
        }
        ok={failedCount === 0}
      />
      <Row
        label="Modules"
        value={
          modules.length === 0
            ? "\u2014"
            : degradedModules > 0
              ? `${okModules} ok, ${degradedModules} degraded`
              : `${okModules} ok`
        }
        ok={degradedModules === 0 && modules.length > 0}
      />
    </div>
  );
}

function Row({
  label,
  value,
  ok,
}: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          ok === true ? "text-green-500" : ok === false ? "text-yellow-500" : ""
        }
      >
        {value}
      </span>
    </div>
  );
}
