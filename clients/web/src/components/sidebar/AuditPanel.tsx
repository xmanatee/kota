import { auditQuery } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function AuditPanel() {
  const { data } = useQuery(auditQuery);
  const [riskFilter, setRiskFilter] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");

  const entries = (data?.entries ?? []).filter((e) => {
    if (riskFilter && e.risk !== riskFilter) return false;
    if (policyFilter && e.policy !== policyFilter) return false;
    return true;
  });

  const riskVariant = (risk: string) =>
    risk === "safe"
      ? ("success" as const)
      : risk === "moderate"
        ? ("warning" as const)
        : ("destructive" as const);

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <Select
          className="h-7 text-xs"
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
        >
          <option value="">All risk</option>
          <option value="safe">Safe</option>
          <option value="moderate">Moderate</option>
          <option value="dangerous">Dangerous</option>
        </Select>
        <Select
          className="h-7 text-xs"
          value={policyFilter}
          onChange={(e) => setPolicyFilter(e.target.value)}
        >
          <option value="">All policy</option>
          <option value="allow">Allow</option>
          <option value="confirm">Confirm</option>
          <option value="deny">Deny</option>
          <option value="queue">Queue</option>
        </Select>
      </div>
      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">No audit entries</div>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="flex items-center gap-1.5 text-xs">
            <Badge
              variant={riskVariant(e.risk)}
              className="h-4 px-1 text-[10px]"
            >
              {e.risk}
            </Badge>
            <span className="flex-1 truncate">{e.tool}</span>
            <span className="text-[10px] text-muted-foreground">
              {e.policy}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
