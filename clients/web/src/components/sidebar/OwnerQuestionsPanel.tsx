import { api } from "@/api/client";
import { ownerQuestionsQuery, queryKeys } from "@/api/queries";
import type { PendingOwnerQuestion } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectId } from "@/lib/project-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function OwnerQuestionsPanel() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { data } = useQuery(ownerQuestionsQuery(projectId));
  const questions = data?.questions ?? [];

  if (questions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No pending owner questions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {questions.map((q) => (
        <OwnerQuestionRow
          key={q.id}
          question={q}
          onResolved={() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.ownerQuestions(projectId),
            })
          }
        />
      ))}
    </div>
  );
}

function OwnerQuestionRow({
  question,
  onResolved,
}: {
  question: PendingOwnerQuestion;
  onResolved: () => void;
}) {
  const [answer, setAnswer] = useState("");

  const answerMutation = useMutation({
    mutationFn: (text: string) => api.answerOwnerQuestion(question.id, text),
    onSuccess: () => {
      setAnswer("");
      onResolved();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: () => api.dismissOwnerQuestion(question.id),
    onSuccess: () => onResolved(),
  });

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    answerMutation.mutate(trimmed);
  };

  return (
    <div className="rounded border border-border p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Badge variant="warning">owner</Badge>
        <span className="truncate text-muted-foreground">
          {question.source}
        </span>
      </div>
      <div className="mt-1.5 font-medium">{question.question}</div>
      {question.context && (
        <div className="mt-1 text-muted-foreground whitespace-pre-wrap">
          {question.context}
        </div>
      )}
      <div className="mt-1 text-muted-foreground">
        <span className="text-foreground/80">Why:</span> {question.reason}
      </div>
      {question.proposedAnswers && question.proposedAnswers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {question.proposedAnswers.map((proposed) => (
            <Button
              key={proposed}
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => submit(proposed)}
              disabled={answerMutation.isPending || dismissMutation.isPending}
            >
              {proposed}
            </Button>
          ))}
        </div>
      )}
      <form
        className="mt-1.5 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit(answer);
        }}
      >
        <Input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer"
          className="h-7 text-xs"
          disabled={answerMutation.isPending || dismissMutation.isPending}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={
            !answer.trim() ||
            answerMutation.isPending ||
            dismissMutation.isPending
          }
        >
          Answer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => dismissMutation.mutate()}
          disabled={answerMutation.isPending || dismissMutation.isPending}
        >
          Dismiss
        </Button>
      </form>
    </div>
  );
}
