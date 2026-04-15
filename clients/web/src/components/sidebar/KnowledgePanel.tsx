import { knowledgeQuery } from "@/api/queries";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function KnowledgePanel() {
  const { data } = useQuery(knowledgeQuery);
  const [filter, setFilter] = useState("");
  const entries = (data?.entries ?? []).filter(
    (e) =>
      !filter ||
      e.title.toLowerCase().includes(filter.toLowerCase()) ||
      e.category.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-1">
      <Input
        className="h-7 text-xs"
        placeholder="Filter..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {filter ? "No matches" : "No knowledge entries"}
        </div>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="text-xs">
            <div className="truncate font-medium">{e.title}</div>
            <div className="truncate text-muted-foreground">{e.category}</div>
          </div>
        ))
      )}
    </div>
  );
}
