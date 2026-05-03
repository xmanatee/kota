import { api } from "@/api/client";
import type { KnowledgeSearchResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { renderKnowledgeSearchPlain } from "./knowledgeRender";

const SEMANTIC_UNAVAILABLE_TEXT =
  "Semantic knowledge search requires an embedding-backed knowledge provider.";

export function KnowledgePanel() {
  const [draft, setDraft] = useState("");
  const search = useMutation<KnowledgeSearchResponse, Error, string>({
    mutationFn: (query: string) => api.knowledge.search(query),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === "") return;
    search.mutate(trimmed);
  }

  return (
    <div className="space-y-1.5">
      <form className="flex gap-1.5" onSubmit={onSubmit}>
        <Input
          className="h-7 text-xs"
          placeholder="Search knowledge..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={draft.trim() === "" || search.isPending}
        >
          {search.isPending ? "..." : "Search"}
        </Button>
      </form>

      {search.isError && (
        <div className="text-xs text-destructive">{search.error.message}</div>
      )}

      {search.data && <KnowledgeResultView result={search.data} />}
    </div>
  );
}

function KnowledgeResultView({ result }: { result: KnowledgeSearchResponse }) {
  if (!result.ok) {
    return (
      <div className="text-xs text-muted-foreground">
        {SEMANTIC_UNAVAILABLE_TEXT}
      </div>
    );
  }
  if (result.entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No matching knowledge entries.
      </div>
    );
  }
  return (
    <pre className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-5 text-foreground">
      {renderKnowledgeSearchPlain(result.entries)}
    </pre>
  );
}
