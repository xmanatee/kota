import { api } from "@/api/client";
import {
  CAPTURE_TARGET_ORDER,
  type CaptureRecord,
  type CaptureResult,
  type CaptureTarget,
} from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactElement, useState } from "react";

type TargetChoice = "auto" | CaptureTarget;

const TARGET_BADGE_VARIANT: Record<
  CaptureTarget,
  "default" | "secondary" | "success" | "warning" | "running"
> = {
  knowledge: "default",
  memory: "secondary",
  tasks: "warning",
  inbox: "running",
};

type CaptureRequest = { text: string; target: TargetChoice };

function dispatchCapture(req: CaptureRequest): Promise<CaptureResult> {
  if (req.target === "auto") return api.capture(req.text);
  return api.capture(req.text, { target: req.target });
}

export function CapturePanel() {
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<TargetChoice>("auto");
  const capture = useMutation<CaptureResult, Error, CaptureRequest>({
    mutationFn: dispatchCapture,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === "") return;
    capture.mutate({ text: trimmed, target });
  }

  function reissueWithTarget(suggestion: CaptureTarget): void {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    capture.mutate({ text: trimmed, target: suggestion });
  }

  return (
    <div className="space-y-1.5">
      <form className="space-y-1.5" onSubmit={onSubmit}>
        <Textarea
          className="min-h-[60px] text-xs"
          placeholder="Capture a note across stores..."
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-1.5">
          <Select
            className="h-7 flex-1 text-xs"
            value={target}
            onChange={(e) => setTarget(e.target.value as TargetChoice)}
            aria-label="Capture target"
          >
            <option value="auto">auto</option>
            {CAPTURE_TARGET_ORDER.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={draft.trim() === "" || capture.isPending}
          >
            {capture.isPending ? "..." : "Capture"}
          </Button>
        </div>
      </form>

      {capture.isError && (
        <div className="text-xs text-destructive">{capture.error.message}</div>
      )}

      {capture.data && (
        <CaptureResultView
          result={capture.data}
          onSuggestionPick={reissueWithTarget}
        />
      )}
    </div>
  );
}

function CaptureResultView({
  result,
  onSuggestionPick,
}: {
  result: CaptureResult;
  onSuggestionPick: (target: CaptureTarget) => void;
}): ReactElement {
  if (result.ok) {
    return <CaptureSuccessRow record={result.record} />;
  }
  switch (result.reason) {
    case "ambiguous":
      return (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Capture target is ambiguous — pick a store:
          </div>
          <div className="flex flex-wrap gap-1">
            {result.suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => onSuggestionPick(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      );
    case "no_contributors":
      return (
        <div className="text-xs text-muted-foreground">
          Capture unavailable — no contributors registered.
        </div>
      );
    case "contributor_failed":
      return (
        <div className="flex items-start gap-1.5 text-xs">
          <Badge
            variant={TARGET_BADGE_VARIANT[result.target]}
            className="h-5 shrink-0 text-[10px]"
          >
            {result.target}
          </Badge>
          <div className="min-w-0 flex-1 text-destructive">
            {result.message}
          </div>
        </div>
      );
  }
}

function CaptureSuccessRow({ record }: { record: CaptureRecord }) {
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Badge
        variant={TARGET_BADGE_VARIANT[record.target]}
        className="h-5 shrink-0 text-[10px]"
      >
        {record.target}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {record.recordId}
        </div>
        <CapturePathLine record={record} />
      </div>
    </div>
  );
}

function CapturePathLine({ record }: { record: CaptureRecord }) {
  switch (record.target) {
    case "memory":
    case "knowledge":
      return null;
    case "tasks":
    case "inbox":
      return (
        <div className="truncate text-[10px] text-muted-foreground">
          {record.path}
        </div>
      );
  }
}
