import { api } from "@/api/client";
import type {
  AnswerHistoryEntry,
  AnswerHistoryListResult,
  AnswerHistoryShowResult,
} from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AnswerResultView } from "./AnswerResultView";

const QUERY_TRUNCATE = 60;

type View = { mode: "log" } | { mode: "show"; id: string };

export function AnswerHistoryPanel() {
  const [view, setView] = useState<View>({ mode: "log" });

  if (view.mode === "log") {
    return (
      <LogView
        onSelect={(id) => {
          setView({ mode: "show", id });
        }}
      />
    );
  }
  return (
    <ShowView
      id={view.id}
      onBack={() => {
        setView({ mode: "log" });
      }}
    />
  );
}

function LogView({ onSelect }: { onSelect: (id: string) => void }) {
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [pages, setPages] = useState<AnswerHistoryEntry[][]>([]);

  const log = useQuery<AnswerHistoryListResult>({
    queryKey: ["answer-log", beforeId],
    queryFn: async () =>
      api.answerLog(beforeId === null ? undefined : { beforeId }),
  });

  const lastPageEntries = log.data?.entries;

  function loadOlder(): void {
    if (!lastPageEntries || lastPageEntries.length === 0) return;
    const lastId = lastPageEntries[lastPageEntries.length - 1]!.id;
    setPages((prev) => [...prev, lastPageEntries]);
    setBeforeId(lastId);
  }

  if (log.isPending) {
    return <div className="text-xs text-muted-foreground">Loading...</div>;
  }
  if (log.isError) {
    return <div className="text-xs text-destructive">{log.error.message}</div>;
  }

  const allEntries = pages.flat().concat(log.data.entries);
  if (allEntries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No answers in history yet.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-1">
        {allEntries.map((entry) => (
          <LogRow key={entry.id} entry={entry} onSelect={onSelect} />
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        onClick={loadOlder}
        disabled={log.data.entries.length === 0}
      >
        Load older
      </Button>
    </div>
  );
}

function LogRow({
  entry,
  onSelect,
}: {
  entry: AnswerHistoryEntry;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-1.5 rounded text-left text-xs hover:bg-accent/50"
      onClick={() => {
        onSelect(entry.id);
      }}
    >
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatTimestamp(entry.createdAt)}
      </span>
      <ResultBadge entry={entry} />
      <span className="min-w-0 flex-1 truncate">
        {truncateQuery(entry.query)}
      </span>
    </button>
  );
}

function ResultBadge({ entry }: { entry: AnswerHistoryEntry }) {
  if (entry.result.ok) {
    return (
      <Badge variant="success" className="h-5 shrink-0 text-[10px]">
        ok({entry.result.citationCount})
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="h-5 shrink-0 text-[10px]">
      {entry.result.reason}
    </Badge>
  );
}

function ShowView({ id, onBack }: { id: string; onBack: () => void }) {
  const show = useQuery<AnswerHistoryShowResult>({
    queryKey: ["answer-show", id],
    queryFn: async () => api.answerShow(id),
  });

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onBack}
      >
        Back
      </Button>
      {show.isPending && (
        <div className="text-xs text-muted-foreground">Loading...</div>
      )}
      {show.isError && (
        <div className="text-xs text-destructive">{show.error.message}</div>
      )}
      {show.data && <ShowResultView result={show.data} />}
    </div>
  );
}

function ShowResultView({ result }: { result: AnswerHistoryShowResult }) {
  if (!result.ok) {
    return (
      <div className="text-xs text-muted-foreground">
        No answer record with that id.
      </div>
    );
  }
  const { record } = result;
  return (
    <div className="space-y-2">
      <div className="space-y-0.5 border-b border-border pb-1.5">
        <div className="font-mono text-[10px] text-muted-foreground">
          {record.id}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {record.createdAt}
        </div>
        <div className="text-xs">{record.query}</div>
      </div>
      <AnswerResultView result={record.result} />
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const idx = iso.indexOf(".");
  const head = idx >= 0 ? iso.slice(0, idx) : iso;
  return `${head}Z`.replace(/Z+$/, "Z");
}

function truncateQuery(text: string): string {
  if (text.length <= QUERY_TRUNCATE) return text;
  return `${text.slice(0, QUERY_TRUNCATE - 1)}…`;
}
