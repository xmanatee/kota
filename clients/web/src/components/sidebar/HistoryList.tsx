import { historyQuery } from "@/api/queries";
import { useQuery } from "@tanstack/react-query";

export function HistoryList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data } = useQuery(historyQuery({ limit: 20 }));
  const conversations = data?.conversations ?? [];

  if (conversations.length === 0) {
    return <div className="text-xs text-muted-foreground">No history</div>;
  }

  return (
    <div className="space-y-1">
      {conversations.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
        >
          {c.title ?? c.id.slice(0, 20)}
          <span className="ml-1 text-muted-foreground">({c.messageCount})</span>
        </button>
      ))}
    </div>
  );
}
