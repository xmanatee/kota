import { api } from "@/api/client";
import type { AnswerResult } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { AnswerResultView } from "./AnswerResultView";

export function AnswerPanel() {
  const [draft, setDraft] = useState("");
  const answer = useMutation<AnswerResult, Error, string>({
    mutationFn: (query: string) => api.answer(query),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === "") return;
    answer.mutate(trimmed);
  }

  return (
    <div className="space-y-1.5">
      <form className="flex gap-1.5" onSubmit={onSubmit}>
        <Input
          className="h-7 text-xs"
          placeholder="Ask the second brain..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={draft.trim() === "" || answer.isPending}
        >
          {answer.isPending ? "..." : "Answer"}
        </Button>
      </form>

      {answer.isError && (
        <div className="text-xs text-destructive">{answer.error.message}</div>
      )}

      {answer.data && <AnswerResultView result={answer.data} />}
    </div>
  );
}
